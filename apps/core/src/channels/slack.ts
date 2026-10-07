// Slack in Socket Mode: the app opens a WebSocket (apps.connections.open, with the app-level token) and Slack pushes
// events over it; answers go out through the Web API with the bot token. No public URL and no library. Only direct
// messages to the app are read; buttons are Block Kit actions and a press comes back as an interactive envelope.
// Each envelope is handed over (and stored) before it is acknowledged, so a crash never loses a message.
import type { Presentation } from "../domain/channels.ts";
import { errorMessage } from "../errors.ts";
import { causeCode, NEVER_SENT, sleep, splitText } from "./net.ts";
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
/** Slack takes far longer messages, but reads best in parts like these. */
const MAX_CHARS = 3500;

type SlackReply = { ok: boolean; error?: string } & Record<string, unknown>;
type SlackEvent = {
  type?: string;
  subtype?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  client_msg_id?: string;
};
type Envelope = {
  type: string;
  envelope_id?: string;
  payload?: {
    event?: SlackEvent;
    type?: string;
    user?: { id: string; name?: string; username?: string };
    channel?: { id: string };
    container?: { message_ts?: string; channel_id?: string };
    actions?: Array<{ action_id?: string; value?: string }>;
  };
};

class SlackError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number | undefined;
  constructor(status: number, code: string, retryAfter?: number) {
    super(`Slack: ${code}`);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** The two tokens a Slack app needs, stored as one secret: "xoxb-… xapp-…" in any order. */
export function slackTokens(secret: string | undefined): { bot?: string; app?: string } {
  const words = (secret ?? "").split(/\s+/);
  return { bot: words.find((w) => w.startsWith("xoxb-")), app: words.find((w) => w.startsWith("xapp-")) };
}

/** Markdown as Slack's mrkdwn: bold with one star, links as <url|text>, and its three special characters escaped. */
export function toSlackMrkdwn(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
}

export const slackAdapter = ((config, secret, apiBase = "https://slack.com/api"): ChannelAdapter => {
  const ac = new AbortController();
  const { bot, app } = slackTokens(secret);
  let socket: WebSocket | undefined;
  let loop: Promise<void> | undefined;
  const names = new Map<string, string>();

  async function api<T extends SlackReply>(method: string, body: object, auth = bot, timeoutMs = CALL_MS): Promise<T> {
    if (!auth) throw new SlackError(401, "not_authed");
    const res = await fetch(`${apiBase}/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${auth}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (res.status === 429) throw new SlackError(429, "ratelimited", Number(res.headers.get("retry-after") ?? 5));
    const j = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as T;
    if (!j.ok) throw new SlackError(res.status, j.error ?? "unknown_error");
    return j;
  }

  /** "Ana Pérez (@ana)", looked up once per person. */
  async function nameOf(userId: string): Promise<string> {
    const known = names.get(userId);
    if (known) return known;
    try {
      const r = await api<SlackReply & { user?: { name?: string; real_name?: string } }>("users.info", {
        user: userId,
      });
      const real = (r.user?.real_name ?? "")
        .replace(/[\p{Cc}\p{Cf}]/gu, "")
        .trim()
        .slice(0, 60);
      const handle = r.user?.name ? `@${r.user.name}` : `id ${userId}`;
      const name = real ? `${real} (${handle})` : handle;
      names.set(userId, name);
      return name;
    } catch {
      return `id ${userId}`;
    }
  }

  async function handle(e: Envelope, io: AdapterIO): Promise<void> {
    const ev = e.payload?.event;
    if (e.type === "events_api" && ev?.type === "message") {
      // Direct messages from people only: no edits, joins or the app's own words.
      if (ev.channel_type !== "im" || ev.subtype || ev.bot_id || !ev.user || !ev.channel) return;
      io.receive({
        external_id: ev.client_msg_id ?? `${ev.channel}:${ev.ts}`,
        conversation: ev.channel,
        sender: { id: ev.user, name: await nameOf(ev.user) },
        text: ev.text ?? "",
        private: true,
      });
    } else if (e.type === "interactive" && e.payload?.type === "block_actions") {
      const p = e.payload;
      const channel = p.channel?.id ?? p.container?.channel_id;
      const data = p.actions?.[0]?.value ?? p.actions?.[0]?.action_id;
      if (!p.user || !channel || !data) return;
      // The message keeps its words and loses its buttons, so it cannot be pressed twice.
      const ts = p.container?.message_ts;
      if (ts) void api("chat.update", { channel, ts, blocks: [] }).catch(() => {});
      io.action({ conversation: channel, sender: { id: p.user.id, name: await nameOf(p.user.id) }, data });
    }
  }

  /** One socket: Slack says hello, pushes envelopes, and asks to reconnect now and then. */
  async function session(io: AdapterIO): Promise<void> {
    const { url } = await api<SlackReply & { url: string }>("apps.connections.open", {}, app);
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(url);
      socket = ws;
      ws.addEventListener("message", (msg) => {
        let e: Envelope;
        try {
          e = JSON.parse(String(msg.data)) as Envelope;
        } catch {
          return;
        }
        if (e.type === "hello") return io.status("running");
        if (e.type === "disconnect") return ws.close(1000, "slack asked to reconnect");
        void handle(e, io)
          .catch(() => {})
          .finally(() => {
            if (e.envelope_id && ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ envelope_id: e.envelope_id }));
          });
      });
      ws.addEventListener("close", () => resolve());
      ws.addEventListener("error", () => {});
    });
  }

  async function run(io: AdapterIO): Promise<void> {
    let backoff = 1000;
    while (!ac.signal.aborted && !io.signal.aborted) {
      const opened = Date.now();
      try {
        await session(io);
      } catch (err) {
        if (ac.signal.aborted || io.signal.aborted) return;
        if (
          err instanceof SlackError &&
          /invalid_auth|not_authed|not_allowed_token_type|account_inactive/.test(err.code)
        ) {
          io.status("error", "Slack refused the app-level token (xapp-…, with connections:write)");
          return;
        }
        io.status("error", `cannot reach Slack: ${errorMessage(err)}`.slice(0, 200));
      }
      if (ac.signal.aborted || io.signal.aborted) return;
      if (Date.now() - opened > 60_000) backoff = 1000;
      await sleep(backoff, AbortSignal.any([ac.signal, io.signal]));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  async function sendText(channel: string, text: string, buttons: Presentation["buttons"]): Promise<string> {
    const mrkdwn = toSlackMrkdwn(text);
    const blocks = buttons?.length
      ? [
          { type: "section", text: { type: "mrkdwn", text: mrkdwn } },
          {
            type: "actions",
            elements: buttons.slice(0, 5).map((b, i) => ({
              type: "button",
              action_id: `apx_${i}`,
              text: { type: "plain_text", text: b.label.slice(0, 75) },
              value: b.id.slice(0, 2000),
            })),
          },
        ]
      : undefined;
    const r = await api<SlackReply & { ts: string }>("chat.postMessage", {
      channel,
      text: mrkdwn,
      unfurl_links: false,
      ...(blocks ? { blocks } : {}),
    });
    return r.ts;
  }

  async function sendFile(channel: string, f: OutFile): Promise<string> {
    const filename = fileName(f);
    const up = await api<SlackReply & { upload_url: string; file_id: string }>("files.getUploadURLExternal", {
      filename,
      length: f.data.length,
    });
    const res = await fetch(up.upload_url, {
      method: "POST",
      body: new Uint8Array(f.data),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(UPLOAD_MS)]),
    });
    if (!res.ok) throw new SlackError(res.status, `upload failed (HTTP ${res.status})`);
    await api("files.completeUploadExternal", { files: [{ id: up.file_id, title: filename }], channel_id: channel });
    return up.file_id;
  }

  return {
    caps: { typing: false, buttons: true },
    async start(io) {
      if (!bot || !app) throw new ChannelRefused("Slack needs both tokens: the bot's (xoxb-…) and the app's (xapp-…)");
      const me = await api<SlackReply & { user?: string; team?: string }>("auth.test", {}).catch((err: unknown) => {
        throw err instanceof SlackError && /invalid_auth|not_authed|account_inactive/.test(err.code)
          ? new ChannelRefused("Slack refused the bot token (xoxb-…): copy it again from the app's settings")
          : err;
      });
      loop = run(io);
      // Running once the socket says hello: a message pushed before that would find no one listening.
      return { account: me.user ? `@${me.user}${me.team ? ` · ${me.team}` : ""}` : config.label, waiting: true };
    },
    async stop() {
      ac.abort();
      socket?.close(1000, "stopped");
      await loop?.catch(() => {});
    },
    async send(conversation, p, files = []) {
      const texts = p.text.trim() ? splitText(p.text, MAX_CHARS) : [];
      const steps: Array<() => Promise<string>> = [
        ...texts.map((t, i) => () => sendText(conversation, t, i === texts.length - 1 ? p.buttons : undefined)),
        ...files.map((f) => () => sendFile(conversation, f)),
      ];
      let last: string | undefined;
      for (let i = p.skip ?? 0; i < steps.length; i++) {
        try {
          last = await (steps[i] as () => Promise<string>)();
        } catch (err) {
          throw toSendError(err, i - (p.skip ?? 0));
        }
      }
      return last === undefined ? {} : { external_id: last };
    },
    async avatar(userId) {
      const r = await api<SlackReply & { user?: { profile?: { image_192?: string } } }>("users.info", { user: userId });
      const url = r.user?.profile?.image_192;
      if (!url) return undefined;
      const res = await fetch(url, { signal: AbortSignal.timeout(CALL_MS) });
      return res.ok
        ? { mime: res.headers.get("content-type") ?? "image/png", data: Buffer.from(await res.arrayBuffer()) }
        : undefined;
    },
  };
}) satisfies (...args: [...Parameters<AdapterFactory>, string?]) => ChannelAdapter;

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof SlackError) {
    if (err.status === 429 || err.code === "ratelimited")
      return new SendError("retry", msg, (err.retryAfter ?? 5) * 1000, sent);
    if (err.status >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  const code = causeCode(err);
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}
