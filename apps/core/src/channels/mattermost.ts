// Mattermost with a bot account: posts arrive over the server's WebSocket (/api/v4/websocket), answers go out
// through the REST API. Any server, a bot token, no library. Only direct messages are read; buttons become numbered
// options (interactive buttons need a public URL for their callbacks).
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
const MAX_CHARS = 4000;

type Post = { id?: string; user_id?: string; channel_id?: string; message?: string; type?: string };
type WsEvent = {
  event?: string;
  seq_reply?: number;
  status?: string;
  data?: { post?: string; channel_type?: string; sender_name?: string };
};

class MattermostError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Mattermost: ${message}`);
    this.status = status;
  }
}

/** The server and the bot's token, stored as one secret: "https://chat.example.org abc123…" in any order. */
export function mattermostSecret(secret: string | undefined): { server?: string; token?: string } {
  const words = (secret ?? "").split(/\s+/).filter(Boolean);
  const server = words.find((w) => /^https?:\/\//.test(w))?.replace(/\/+$/, "");
  const token = words.find((w) => !/^https?:\/\//.test(w));
  return { ...(server ? { server } : {}), ...(token ? { token } : {}) };
}

export const mattermostAdapter = ((_config, secret): ChannelAdapter => {
  const ac = new AbortController();
  const { server, token } = mattermostSecret(secret);
  let me = "";
  let socket: WebSocket | undefined;
  let seq = 1;
  let loop: Promise<void> | undefined;
  const options = numberedOptions();

  async function api<T>(method: string, path: string, body?: unknown, timeoutMs = CALL_MS): Promise<T> {
    if (!server || !token) throw new MattermostError(401, "no token");
    const res = await fetch(`${server}/api/v4${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]),
    });
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) throw new MattermostError(res.status, j.message ?? `HTTP ${res.status}`);
    return j as T;
  }

  function handle(e: WsEvent, io: AdapterIO): void {
    if (e.event !== "posted" || e.data?.channel_type !== "D" || !e.data.post) return;
    let post: Post;
    try {
      post = JSON.parse(e.data.post) as Post;
    } catch {
      return;
    }
    // People's words only: no system posts, no edits, never the bot's own.
    if (!post.id || !post.user_id || !post.channel_id || post.user_id === me || post.type) return;
    const handle = (e.data.sender_name ?? "")
      .replace(/^@/, "")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .slice(0, 60);
    const sender = { id: post.user_id, name: handle ? `@${handle}` : `id ${post.user_id}` };
    const text = post.message ?? "";
    const picked = options.pick(post.channel_id, text);
    if (picked) io.action({ conversation: post.channel_id, sender, data: picked });
    else io.receive({ external_id: post.id, conversation: post.channel_id, sender, text, private: true });
  }

  /** One socket: authenticate, then posted events until it closes. */
  async function session(io: AdapterIO): Promise<void> {
    if (!server || !token) return;
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${server.replace(/^http/, "ws")}/api/v4/websocket`);
      socket = ws;
      ws.addEventListener("open", () =>
        ws.send(JSON.stringify({ seq: seq++, action: "authentication_challenge", data: { token } })),
      );
      ws.addEventListener("message", (msg) => {
        let e: WsEvent;
        try {
          e = JSON.parse(String(msg.data)) as WsEvent;
        } catch {
          return;
        }
        if (e.event === "hello" || (e.seq_reply !== undefined && e.status === "OK")) return io.status("running");
        handle(e, io);
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
        io.status("error", `cannot reach Mattermost: ${errorMessage(err)}`.slice(0, 200));
      }
      if (ac.signal.aborted || io.signal.aborted) return;
      if (Date.now() - opened > 60_000) backoff = 1000;
      await sleep(backoff, AbortSignal.any([ac.signal, io.signal]));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  async function sendText(channel: string, text: string): Promise<string> {
    return (await api<{ id: string }>("POST", "/posts", { channel_id: channel, message: text })).id;
  }

  async function sendFile(channel: string, f: OutFile): Promise<string> {
    if (!server || !token) throw new MattermostError(401, "no token");
    const form = new FormData();
    form.set("channel_id", channel);
    form.set("files", new Blob([new Uint8Array(f.data)], { type: f.mime }), fileName(f));
    const res = await fetch(`${server}/api/v4/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(UPLOAD_MS)]),
    });
    if (!res.ok) throw new MattermostError(res.status, `upload failed (HTTP ${res.status})`);
    const up = (await res.json()) as { file_infos?: Array<{ id: string }> };
    const ids = (up.file_infos ?? []).map((x) => x.id);
    return (await api<{ id: string }>("POST", "/posts", { channel_id: channel, message: "", file_ids: ids })).id;
  }

  return {
    caps: { typing: true, buttons: false },
    async start(io) {
      if (!server || !token)
        throw new ChannelRefused("Mattermost needs the server's address (https://…) and a bot token");
      const user = await api<{ id: string; username: string }>("GET", "/users/me").catch((err: unknown) => {
        throw err instanceof MattermostError && (err.status === 401 || err.status === 403)
          ? new ChannelRefused("Mattermost refused the bot token: copy it again from the bot account")
          : err;
      });
      me = user.id;
      loop = run(io);
      return { account: `@${user.username}`, waiting: true };
    },
    async stop() {
      ac.abort();
      socket?.close(1000, "stopped");
      await loop?.catch(() => {});
    },
    async send(conversation, p, files = []) {
      const full = options.text(conversation, p.text, p.buttons);
      const texts = full.trim() ? splitText(full, MAX_CHARS) : [];
      const steps: Array<() => Promise<string>> = [
        ...texts.map((t) => () => sendText(conversation, t)),
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
    async typing(conversation) {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ seq: seq++, action: "user_typing", data: { channel_id: conversation } }));
    },
  };
}) satisfies AdapterFactory;

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof MattermostError) {
    if (err.status === 429) return new SendError("retry", msg, 5000, sent);
    if (err.status >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  const code = causeCode(err);
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}
