// ntfy (ntfy.sh or a self-hosted server) as a simple channel to the owner's phone: the owner subscribes to a private
// topic in the ntfy app; the agent's messages are published there and the owner's replies are read from the same
// topic's JSON stream. ntfy has no identity on messages, so the channel has one person: the owner.
// Whoever knows the topic can write to it as the owner: use an access token on a protected topic (ntfy ACL), or at
// least a long random topic name. The last message id read lives in the channel's folder, so a restart never replays.
import fs from "node:fs";
import path from "node:path";
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

const CALL_MS = 20_000;
const UPLOAD_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;
/** ntfy keeps 4096 bytes of a message by default; longer ones become a file. */
const MAX_CHARS = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Images an agent can read; other attachments are only named. */
const KEEP = /^image\/(png|jpeg|gif|webp)$/;
/**
 * The tag on what APX publishes: one topic both ways, so the owner subscribes once and replies under the agent's
 * messages; the tag comes back on every event (even replayed after a restart), so APX never reads its own words.
 */
const MARK = "apx";
/** The one person writing on an ntfy topic. */
export const NTFY_OWNER = "owner";

type NtfyEvent = {
  id?: string;
  event?: string;
  message?: string;
  tags?: string[];
  attachment?: { name?: string; type?: string; size?: number; url?: string };
};

class NtfyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`ntfy: ${message}`);
    this.status = status;
  }
}

/** The server, the topic and an optional access token, as one secret: "https://ntfy.sh apx-abc123 tk_xyz". */
export function ntfySecret(raw: string | undefined): { server: string; topic: string; token?: string } | undefined {
  const words = (raw ?? "").split(/\s+/).filter(Boolean);
  const server = words.find((w) => /^https?:\/\//.test(w))?.replace(/\/+$/, "");
  const rest = words.filter((w) => !/^https?:\/\//.test(w));
  const token = rest.find((w) => w.startsWith("tk_")) ?? rest[1];
  const topic = rest.find((w) => w !== token);
  if (!server || !topic || !/^[-_A-Za-z0-9]{1,64}$/.test(topic)) return undefined;
  return { server, topic, ...(token ? { token } : {}) };
}

export function ntfyAdapter(config: Parameters<AdapterFactory>[0], secret: string | undefined, opts: { dir: string }) {
  const ac = new AbortController();
  const target = ntfySecret(secret);
  const stateFile = path.join(opts.dir, "ntfy-state.json");
  let since = readSince(stateFile);
  let loop: Promise<void> | undefined;
  const options = numberedOptions();

  const auth = (): Record<string, string> => (target?.token ? { authorization: `Bearer ${target.token}` } : {});
  const topicUrl = () => `${target?.server}/${target?.topic}`;

  function save(): void {
    fs.mkdirSync(opts.dir, { recursive: true });
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ since }), { mode: 0o600 });
    fs.renameSync(tmp, stateFile);
  }

  async function file(a: NonNullable<NtfyEvent["attachment"]>): Promise<{ name: string; mime: string; data: string }> {
    const res = await fetch(a.url ?? "", {
      headers: auth(),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(UPLOAD_MS)]),
    });
    if (!res.ok) throw new NtfyError(res.status, `attachment: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_FILE_BYTES) throw new NtfyError(413, "attachment too big");
    return { name: (a.name ?? "image").slice(0, 120), mime: a.type ?? "image/png", data: data.toString("base64") };
  }

  async function handle(e: NtfyEvent, io: AdapterIO): Promise<void> {
    if (e.event === "open") return io.status("running");
    if (e.event !== "message" || !e.id || !target) return;
    since = e.id;
    save();
    if (e.tags?.includes(MARK)) return;
    let text = (e.message ?? "").trim();
    const files: Array<{ name: string; mime: string; data: string }> = [];
    const a = e.attachment;
    if (a?.url) {
      const keep = KEEP.test(a.type ?? "") && (a.size ?? 0) <= MAX_FILE_BYTES;
      const got = keep ? await file(a).catch(() => undefined) : undefined;
      if (got) files.push(got);
      else text += `${text ? "\n" : ""}[attachment not kept: ${(a.name ?? "file").slice(0, 120)} (${a.type ?? "?"})]`;
      // ntfy puts the file's name as the text of a message that is only a file.
      if (got && text === a.name) text = "";
    }
    if (!text && !files.length) return;
    const sender = { id: NTFY_OWNER, name: `ntfy ${target.topic}` };
    const picked = options.pick(target.topic, text);
    if (picked) io.action({ conversation: target.topic, sender, data: picked });
    else
      io.receive({
        external_id: e.id,
        conversation: target.topic,
        sender,
        text,
        private: true,
        ...(files.length ? { files } : {}),
      });
  }

  /** One subscription: newline-delimited JSON events until the server closes it. */
  async function stream(io: AdapterIO): Promise<void> {
    if (!target) return;
    const q = since ? `?since=${encodeURIComponent(since)}` : "";
    const res = await fetch(`${topicUrl()}/json${q}`, { headers: auth(), signal: ac.signal });
    if (!res.ok || !res.body) throw new NtfyError(res.status, `subscribe: HTTP ${res.status}`);
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line) continue;
        let e: NtfyEvent;
        try {
          e = JSON.parse(line) as NtfyEvent;
        } catch {
          continue;
        }
        await handle(e, io);
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
        io.status("error", `cannot reach ntfy: ${errorMessage(err)}`.slice(0, 200));
      }
      if (ac.signal.aborted || io.signal.aborted) return;
      if (Date.now() - opened > 60_000) backoff = 1000;
      await sleep(backoff, AbortSignal.any([ac.signal, io.signal]));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  async function publish(
    method: "POST" | "PUT",
    body: string | Uint8Array<ArrayBuffer>,
    headers: Record<string, string>,
    ms: number,
  ): Promise<string> {
    const res = await fetch(topicUrl(), {
      method,
      headers: { ...auth(), "x-tags": MARK, ...headers },
      body,
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(ms)]),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok) throw new NtfyError(res.status, j.error ?? `HTTP ${res.status}`);
    return j.id ?? "";
  }

  const sendFile = (f: OutFile, silent: boolean) =>
    publish(
      "PUT",
      new Uint8Array(f.data),
      { filename: fileName(f), ...(silent ? { "x-priority": "2" } : {}) },
      UPLOAD_MS,
    );

  return {
    caps: { typing: false, buttons: false },
    async start(io) {
      if (!target)
        throw new ChannelRefused("ntfy needs the server's address (https://…) and a topic, and an access token if set");
      // A quick poll from now: a refused token or a missing server shows at once.
      const res = await fetch(`${topicUrl()}/json?poll=1&since=${Math.floor(Date.now() / 1000)}`, {
        headers: auth(),
        signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]),
      });
      if (res.status === 401 || res.status === 403)
        throw new ChannelRefused("ntfy refused the access token for that topic: check the token and its access");
      if (!res.ok) throw new NtfyError(res.status, `HTTP ${res.status}`);
      await res.body?.cancel();
      // The owner's address only when the channel says so: otherwise the manager would unlink one paired by code.
      io.identified?.({ account: target.topic, ...(config.self_owner ? { owner: NTFY_OWNER } : {}) });
      loop = run(io);
      return { account: target.topic, waiting: true };
    },
    async stop() {
      ac.abort();
      await loop?.catch(() => {});
    },
    async forget() {
      fs.rmSync(stateFile, { force: true });
    },
    async send(conversation, p, files = []) {
      const full = options.text(conversation, p.text, p.buttons);
      const texts = full.trim() ? splitText(full, MAX_CHARS) : [];
      const quiet: Record<string, string> = p.silent ? { "x-priority": "2" } : {};
      const steps: Array<() => Promise<string>> = [
        ...texts.map(
          (t) => () => publish("POST", t, { "content-type": "text/plain; charset=utf-8", ...quiet }, CALL_MS),
        ),
        ...files.map((f) => () => sendFile(f, Boolean(p.silent))),
      ];
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
  } satisfies ChannelAdapter;
}

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof NtfyError) {
    if (err.status === 429) return new SendError("retry", msg, 10_000, sent);
    if (err.status >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  const code = causeCode(err);
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}

function readSince(file: string): string | undefined {
  try {
    const s = (JSON.parse(fs.readFileSync(file, "utf8")) as { since?: unknown }).since;
    return typeof s === "string" && s ? s : undefined;
  } catch {
    return undefined;
  }
}
