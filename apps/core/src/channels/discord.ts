// Discord through its Gateway (a WebSocket) and REST API, with plain fetch and the platform's WebSocket: no library.
// Direct messages to the bot are read (like Telegram's private chats), and messages in the server rooms the owner
// listed; buttons are message components and a press comes back as an interaction. A message that arrives while the
// socket is down is not redelivered by Discord.
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
/** Discord's limit for one message's text. */
const MAX_CHARS = 2000;
/** DIRECT_MESSAGES | MESSAGE_CONTENT: DMs to the bot, with their text; GUILD_MESSAGES when it has rooms. */
const INTENTS = (1 << 12) | (1 << 15);
const GUILD_MESSAGES = 1 << 9;

type DcUser = { id: string; username?: string; global_name?: string | null; bot?: boolean; avatar?: string | null };
type DcMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: DcUser;
  content?: string;
  mentions?: DcUser[];
  referenced_message?: { author?: DcUser } | null;
};
type DcInteraction = {
  id: string;
  token: string;
  type: number;
  channel_id?: string;
  user?: DcUser;
  member?: { user?: DcUser };
  data?: { custom_id?: string };
};
type Frame = { op: number; d?: unknown; s?: number | null; t?: string | null };

class DcError extends Error {
  readonly status: number;
  readonly retryAfter: number | undefined;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** A sender's name as the owner sees it: their display name and @username, short and on one line. */
function nameOf(u: DcUser): string {
  const name = (u.global_name ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, 60);
  const handle = u.username ? `@${u.username}` : `id ${u.id}`;
  return name ? `${name} (${handle})` : handle;
}

export const discordAdapter = ((
  config,
  token,
  urls: { api: string; gateway: string; cdn: string } = {
    api: "https://discord.com/api/v10",
    gateway: "wss://gateway.discord.gg/?v=10&encoding=json",
    cdn: "https://cdn.discordapp.com",
  },
): ChannelAdapter => {
  const ac = new AbortController();
  let socket: WebSocket | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let loop: Promise<void> | undefined;
  /** The bot's own user id, to know when a room message calls it. */
  let me: string | undefined;
  const rooms = new Set((config.rooms?.rooms ?? []).map((r) => r.id));

  async function api<T>(method: string, route: string, body?: object, timeoutMs = CALL_MS): Promise<T> {
    if (!token) throw new DcError(401, "no bot token");
    const res = await fetch(`${urls.api}${route}`, {
      method,
      headers: { authorization: `Bot ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]),
    });
    return reply<T>(res);
  }

  async function reply<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const j = (await res.json().catch(() => ({}))) as { message?: string; retry_after?: number } & T;
    if (!res.ok) throw new DcError(res.status, j.message ?? `HTTP ${res.status}`, j.retry_after);
    return j as T;
  }

  /** One Gateway session: identify, keep the heartbeat, hand DMs and button presses over until it closes. */
  function session(io: AdapterIO): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(urls.gateway);
      socket = ws;
      let seq: number | null = null;
      let acked = true;
      const send = (f: Frame) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(f));
      ws.addEventListener("message", (msg) => {
        let f: Frame;
        try {
          f = JSON.parse(String(msg.data)) as Frame;
        } catch {
          return;
        }
        if (typeof f.s === "number") seq = f.s;
        if (f.op === 10) {
          const every = (f.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 41_250;
          clearInterval(heartbeat);
          heartbeat = setInterval(() => {
            // No ack since the last beat: the connection is a zombie; a new one is opened.
            if (!acked) return ws.close(4000, "no heartbeat ack");
            acked = false;
            send({ op: 1, d: seq });
          }, every);
          heartbeat.unref?.();
          send({
            op: 2,
            d: {
              token,
              intents: INTENTS | (rooms.size ? GUILD_MESSAGES : 0),
              properties: { os: process.platform, browser: "apx", device: "apx" },
            },
          });
        } else if (f.op === 11) acked = true;
        else if (f.op === 1) send({ op: 1, d: seq });
        else if (f.op === 7 || f.op === 9) ws.close(4000, "reconnect");
        else if (f.op === 0) dispatch(f, io);
      });
      ws.addEventListener("close", (e) => {
        clearInterval(heartbeat);
        // 4004: the token was refused; anything else is worth another connection.
        if (e.code === 4004) reject(new ChannelRefused("Discord refused the bot token"));
        else if (e.code === 4014) reject(new ChannelRefused("turn on the Message Content intent for the bot"));
        else resolve();
      });
      ws.addEventListener("error", () => {});
    });
  }

  function dispatch(f: Frame, io: AdapterIO): void {
    if (f.t === "READY") {
      me = (f.d as { user?: DcUser })?.user?.id ?? me;
      io.status("running");
    } else if (f.t === "MESSAGE_CREATE") {
      const m = f.d as DcMessage;
      // Messages from people only, never another bot; in a server, only the rooms the owner listed.
      if (m.author.bot || (m.guild_id && !rooms.has(m.channel_id))) return;
      const called = Boolean(me) && (m.mentions?.some((u) => u.id === me) || m.referenced_message?.author?.id === me);
      io.receive({
        external_id: m.id,
        conversation: m.channel_id,
        sender: { id: m.author.id, name: nameOf(m.author) },
        // The @mention of the bot itself says nothing: it is how it was called.
        text: (me ? (m.content ?? "").replace(new RegExp(`<@!?${me}>`, "g"), "") : (m.content ?? "")).trim(),
        private: !m.guild_id,
        ...(m.guild_id ? { room: { called: Boolean(called) } } : {}),
      });
    } else if (f.t === "INTERACTION_CREATE") {
      const i = f.d as DcInteraction;
      const user = i.user ?? i.member?.user;
      if (i.type !== 3 || !user || !i.channel_id || !i.data?.custom_id) return;
      // The press is acknowledged at once and its buttons removed, so it cannot be pressed twice.
      void fetch(`${urls.api}/interactions/${i.id}/${i.token}/callback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: 7, data: { components: [] } }),
        signal: AbortSignal.timeout(CALL_MS),
      }).catch(() => {});
      io.action({ conversation: i.channel_id, sender: { id: user.id, name: nameOf(user) }, data: i.data.custom_id });
    }
  }

  async function run(io: AdapterIO): Promise<void> {
    let backoff = 1000;
    while (!ac.signal.aborted && !io.signal.aborted) {
      const opened = Date.now();
      try {
        await session(io);
      } catch (err) {
        io.status("error", errorMessage(err).slice(0, 200));
        if (err instanceof ChannelRefused) return;
      }
      if (ac.signal.aborted || io.signal.aborted) return;
      io.status("error", "connection to Discord lost; connecting again");
      // A session that lasted a while starts the backoff over.
      if (Date.now() - opened > 60_000) backoff = 1000;
      await sleep(backoff, AbortSignal.any([ac.signal, io.signal]));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  async function sendText(
    channel: string,
    content: string,
    buttons: Presentation["buttons"],
    replyTo?: string,
  ): Promise<string> {
    const components = buttons?.length
      ? [
          {
            type: 1,
            components: buttons
              .slice(0, 5)
              .map((b) => ({ type: 2, style: 2, label: b.label.slice(0, 80), custom_id: b.id.slice(0, 100) })),
          },
        ]
      : undefined;
    const r = await api<{ id: string }>("POST", `/channels/${channel}/messages`, {
      content,
      allowed_mentions: { parse: [] },
      ...(components ? { components } : {}),
      ...(replyTo ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {}),
    });
    return r.id;
  }

  async function sendFile(channel: string, f: OutFile): Promise<string> {
    if (!token) throw new DcError(401, "no bot token");
    const name = fileName(f);
    const form = new FormData();
    form.set("payload_json", JSON.stringify({ attachments: [{ id: 0, filename: name }] }));
    form.set("files[0]", new Blob([new Uint8Array(f.data)], { type: f.mime }), name);
    const res = await fetch(`${urls.api}/channels/${channel}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}` },
      body: form,
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(UPLOAD_MS)]),
    });
    return (await reply<{ id: string }>(res)).id;
  }

  return {
    caps: { typing: true, buttons: true },
    async start(io) {
      const me = await api<DcUser>("GET", "/users/@me").catch((err: unknown) => {
        throw err instanceof DcError && err.status === 401
          ? new ChannelRefused("Discord refused the bot token: copy it again from the Developer Portal")
          : err;
      });
      loop = run(io);
      // Running once the gateway says READY: a message sent before that would find no one listening.
      return { account: me.username ? `@${me.username}` : config.label, waiting: true };
    },
    async stop() {
      ac.abort();
      clearInterval(heartbeat);
      socket?.close(1000, "stopped");
      await loop?.catch(() => {});
    },
    async send(conversation, p, files = []) {
      const texts = p.text.trim() ? splitText(p.text, MAX_CHARS) : [];
      const steps: Array<() => Promise<string>> = [
        ...texts.map(
          (t, i) => () =>
            sendText(conversation, t, i === texts.length - 1 ? p.buttons : undefined, i === 0 ? p.reply_to : undefined),
        ),
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
      await api("POST", `/channels/${conversation}/typing`, undefined, 8000);
    },
    async avatar(userId) {
      const u = await api<DcUser>("GET", `/users/${userId}`);
      if (!u.avatar) return undefined;
      const res = await fetch(`${urls.cdn}/avatars/${u.id}/${u.avatar}.png?size=128`, {
        signal: AbortSignal.timeout(CALL_MS),
      });
      return res.ok ? { mime: "image/png", data: Buffer.from(await res.arrayBuffer()) } : undefined;
    },
  };
}) satisfies (
  ...args: [...Parameters<AdapterFactory>, { api: string; gateway: string; cdn: string }?]
) => ChannelAdapter;

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof DcError) {
    if (err.status === 429) return new SendError("retry", msg, (err.retryAfter ?? 5) * 1000, sent);
    if (err.status >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  const code = causeCode(err);
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}
