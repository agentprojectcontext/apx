// Signal through a signal-cli daemon in HTTP mode (`signal-cli -a +NUMBER daemon --http 127.0.0.1:8080`), run by the
// owner beside the core: messages arrive as server-sent events, answers go out as JSON-RPC calls. Signal has no
// official bot API; the daemon is a linked device or a number of its own. Only one-to-one messages are read.
import { randomUUID } from "node:crypto";
import { errorMessage } from "../errors.ts";
import { causeCode, NEVER_SENT, numberedOptions, sleep, splitText } from "./net.ts";
import {
  type AdapterFactory,
  type AdapterIO,
  type ChannelAdapter,
  ChannelRefused,
  fileName,
  type OutFile,
  SendError,
} from "./types.ts";

const CALL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_CHARS = 4000;

type Envelope = {
  source?: string;
  sourceNumber?: string;
  sourceUuid?: string;
  sourceName?: string;
  timestamp?: number;
  dataMessage?: { message?: string | null; timestamp?: number; groupInfo?: unknown; groupV2?: unknown };
  receiptMessage?: { isDelivery?: boolean; isRead?: boolean; timestamps?: number[] };
};

class SignalError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Signal: ${message}`);
    this.status = status;
  }
}

/** The daemon's address and the account's number, stored as one secret: "http://127.0.0.1:8080 +15550001111". */
export function signalSecret(secret: string | undefined): { url?: string; account?: string } {
  const words = (secret ?? "").split(/\s+/).filter(Boolean);
  const url = words.find((w) => /^https?:\/\//.test(w))?.replace(/\/+$/, "");
  const account = words.find((w) => /^\+\d{6,15}$/.test(w));
  return { ...(url ? { url } : {}), ...(account ? { account } : {}) };
}

export const signalAdapter = ((_config, secret): ChannelAdapter => {
  const ac = new AbortController();
  const { url, account } = signalSecret(secret);
  let loop: Promise<void> | undefined;
  const options = numberedOptions();

  async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!url || !account) throw new SignalError(400, "no daemon address or number");
    const res = await fetch(`${url}/api/v1/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params: { account, ...params } }),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]),
    });
    if (!res.ok) throw new SignalError(res.status, `HTTP ${res.status}`);
    const j = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
    if (j.error) throw new SignalError(j.error.code === -5 ? 429 : 400, j.error.message ?? "error");
    return j.result as T;
  }

  function handle(env: Envelope, io: AdapterIO): void {
    const from = env.sourceNumber ?? env.source ?? env.sourceUuid;
    if (!from || from === account) return;
    const r = env.receiptMessage;
    if (r?.timestamps?.length && io.receipt) {
      const state = r.isRead ? "read" : r.isDelivery ? "delivered" : undefined;
      if (state) for (const ts of r.timestamps) io.receipt(String(ts), state);
      return;
    }
    const m = env.dataMessage;
    // One-to-one text only: group messages never reach the agent.
    if (!m || m.groupInfo || m.groupV2 || !m.message) return;
    const name = (env.sourceName ?? "")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .trim()
      .slice(0, 60);
    const sender = { id: from, name: name ? `${name} (${from})` : from };
    const picked = options.pick(from, m.message);
    if (picked) io.action({ conversation: from, sender, data: picked });
    else
      io.receive({
        external_id: `${from}:${m.timestamp ?? env.timestamp ?? Date.now()}`,
        conversation: from,
        sender,
        text: m.message,
        private: true,
      });
  }

  /** One event stream: each `data:` line is a JSON envelope; ends when the daemon closes it. */
  async function stream(io: AdapterIO): Promise<void> {
    if (!url || !account) return;
    const res = await fetch(`${url}/api/v1/events?account=${encodeURIComponent(account)}`, {
      headers: { accept: "text/event-stream" },
      signal: ac.signal,
    });
    if (!res.ok || !res.body) throw new SignalError(res.status, `events: HTTP ${res.status}`);
    io.status("running");
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5)) as { envelope?: Envelope };
          if (j.envelope) handle(j.envelope, io);
        } catch {
          // A line that is not an envelope (a keep-alive) is skipped.
        }
      }
    }
  }

  async function run(io: AdapterIO): Promise<void> {
    let backoff = 1000;
    while (!ac.signal.aborted && !io.signal.aborted) {
      const opened = Date.now();
      try {
        await stream(io);
      } catch (err) {
        if (ac.signal.aborted || io.signal.aborted) return;
        io.status("error", `cannot reach the signal-cli daemon: ${errorMessage(err)}`.slice(0, 200));
      }
      if (ac.signal.aborted || io.signal.aborted) return;
      if (Date.now() - opened > 60_000) backoff = 1000;
      await sleep(backoff, AbortSignal.any([ac.signal, io.signal]));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  async function sendMessage(to: string, text: string, files: OutFile[] = []): Promise<string> {
    const attachments = files.map(
      (f) => `data:${f.mime};filename=${encodeURIComponent(fileName(f))};base64,${f.data.toString("base64")}`,
    );
    const r = await rpc<{ timestamp?: number }>("send", {
      recipient: [to],
      message: text,
      ...(attachments.length ? { attachments } : {}),
    });
    return String(r?.timestamp ?? "");
  }

  return {
    caps: { typing: true, buttons: false },
    async start(io) {
      if (!url || !account)
        throw new ChannelRefused(
          "Signal needs the signal-cli daemon's address (http://…) and the account's number (+…)",
        );
      const ok = await fetch(`${url}/api/v1/check`, { signal: AbortSignal.timeout(CALL_MS) }).catch(() => undefined);
      if (!ok?.ok) throw new Error("the signal-cli daemon does not answer at that address");
      loop = run(io);
      return { account, waiting: true };
    },
    async stop() {
      ac.abort();
      await loop?.catch(() => {});
    },
    async send(conversation, p, files = []) {
      const full = options.text(conversation, p.text, p.buttons);
      const texts = full.trim() ? splitText(full, MAX_CHARS) : [];
      // Files ride with the last text part (Signal sends them as one message), or alone.
      const steps: Array<() => Promise<string>> = texts.length
        ? texts.map((t, i) => () => sendMessage(conversation, t, i === texts.length - 1 ? files : []))
        : files.length
          ? [() => sendMessage(conversation, "", files)]
          : [];
      let last: string | undefined;
      for (let i = p.skip ?? 0; i < steps.length; i++) {
        try {
          last = await (steps[i] as () => Promise<string>)();
        } catch (err) {
          throw toSendError(err, i - (p.skip ?? 0));
        }
      }
      return last ? { external_id: last } : {};
    },
    async typing(conversation) {
      await rpc("sendTyping", { recipient: [conversation] }).catch(() => {});
    },
  };
}) satisfies AdapterFactory;

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof SignalError) {
    if (err.status === 429) return new SendError("retry", msg, 30_000, sent);
    if (err.status >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  const code = causeCode(err);
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}
