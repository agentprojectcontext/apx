// A LINE Official Account through the Messaging API: LINE delivers to the channel's public address (a webhook signed
// with the channel secret) and the core answers with the free reply API while the event's token is fresh, else with
// push. One-to-one chats are contacts; groups and multi-person chats are rooms the owner lists, answered when the bot
// is @mentioned. Buttons are quick replies. Pictures out need a public HTTPS URL, which APX does not serve: only text
// goes out.
import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "../errors.ts";
import { causeCode, NEVER_SENT, sleep, splitText } from "./net.ts";
import {
  type AdapterIO,
  type ChannelAdapter,
  type ChannelConfig,
  ChannelRefused,
  type HookRequest,
  type HookResponse,
  type InboundFile,
  SendError,
} from "./types.ts";

const CALL_MS = 20_000;
/** A reply token lasts a minute from the event and works once; past this it is left for push. */
const REPLY_WINDOW_MS = 50_000;
const MAX_CHARS = 5000;
/** Message objects LINE takes in one reply or push. */
const PER_CALL = 5;
const MAX_QUICK = 13;
const MAX_LABEL = 20;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_BYTES = 1024 * 1024;
const MAX_SEEN = 1000;
const MAX_CACHED = 500;
const ADDRESS_EVERY_MS = 10_000;
const NO_ADDRESS = "Turn on a public address in Settings › Channels: LINE delivers only to a webhook";

type Source = { type?: string; userId?: string; groupId?: string; roomId?: string };
type Mentionee = { index?: number; length?: number; type?: string; userId?: string; isSelf?: boolean };
type LineMessage = {
  id?: string;
  type?: string;
  text?: string;
  quoteToken?: string;
  keywords?: string[];
  address?: string;
  title?: string;
  contentProvider?: { type?: string };
  mention?: { mentionees?: Mentionee[] };
};
type LineEvent = {
  type?: string;
  mode?: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: Source;
  message?: LineMessage;
  postback?: { data?: string };
  deliveryContext?: { isRedelivery?: boolean };
};
type Profile = { name: string; picture?: string | undefined };
type State = { seen: string[] };

class LineError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`LINE: ${message}`);
    this.status = status;
  }
}

/** The channel secret and a long-lived channel access token, stored as one secret: "<32 hex> <token>". */
export function lineSecret(raw: string | undefined): { secret: string; token: string } | undefined {
  const words = (raw ?? "").split(/\s+/).filter(Boolean);
  const secret = words.find((w) => /^[0-9a-f]{32}$/i.test(w));
  const token = words.find((w) => w !== secret && /^[A-Za-z0-9+/=._-]{40,}$/.test(w));
  return secret && token ? { secret, token } : undefined;
}

const readState = (file: string): State => {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<State>;
    return { seen: Array.isArray(s.seen) ? s.seen.filter((x) => typeof x === "string") : [] };
  } catch {
    return { seen: [] };
  }
};
const clean = (s: string) => s.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
/** Where an answer goes: the person (one-to-one), the group or the multi-person chat. */
const conversationOf = (s: Source | undefined) =>
  s?.type === "group" ? s.groupId : s?.type === "room" ? s.roomId : s?.type === "user" ? s.userId : undefined;
/** Bounded caches: the oldest entry goes first. */
const remember = <V>(m: Map<string, V>, key: string, value: V) => {
  m.delete(key);
  m.set(key, value);
  if (m.size > MAX_CACHED) m.delete(m.keys().next().value ?? "");
};

export function lineAdapter(
  config: ChannelConfig,
  raw: string | undefined,
  opts: { dir: string; api?: string; dataApi?: string; now?: () => number; addressEveryMs?: number },
): ChannelAdapter {
  const ac = new AbortController();
  const creds = lineSecret(raw);
  const api = opts.api ?? "https://api.line.me";
  const dataApi = opts.dataApi ?? "https://api-data.line.me";
  const now = opts.now ?? Date.now;
  const listed = new Set((config.rooms?.rooms ?? []).map((r) => r.id));
  const stateFile = path.join(opts.dir, "line-state.json");
  const state = readState(stateFile);
  const seen = new Set(state.seen);
  /** The newest unused reply token of each conversation, and when it came. */
  const replyTokens = new Map<string, { token: string; at: number }>();
  /** A message's quote token, by its id: an answer in a room quotes what it answers. */
  const quotes = new Map<string, string>();
  const profiles = new Map<string, Profile>();
  const groups = new Map<string, string>();
  let io: AdapterIO | undefined;
  let noAddress = false;
  let watch: Promise<void> | undefined;

  function save(): void {
    fs.mkdirSync(opts.dir, { recursive: true });
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ seen: [...seen].slice(-MAX_SEEN) }), { mode: 0o600 });
    fs.renameSync(tmp, stateFile);
  }

  async function call<T>(method: string, route: string, body?: unknown, base = api): Promise<T> {
    if (!creds) throw new LineError(401, "no channel access token");
    const res = await fetch(`${base}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${creds.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]),
    });
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) throw new LineError(res.status, j.message ?? `HTTP ${res.status}`);
    return j as T;
  }

  /** A file's bytes up to `limit`, read as they come so a big one is cut off early. */
  async function download(url: string, limit: number, auth: boolean): Promise<{ mime: string; data: Buffer }> {
    const res = await fetch(url, {
      ...(auth && creds ? { headers: { authorization: `Bearer ${creds.token}` } } : {}),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]),
    });
    if (!res.ok || !res.body) throw new LineError(res.status, `download HTTP ${res.status}`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error("Attachment exceeds the upload size limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return { mime: res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg", data: Buffer.concat(chunks) };
  }

  /** Someone's name and picture: a friend's profile, or a group or chat member's (LINE shows only those). */
  async function profileOf(s: Source): Promise<Profile> {
    const user = s.userId ?? "";
    const route =
      s.type === "group"
        ? `/v2/bot/group/${s.groupId}/member/${user}`
        : s.type === "room"
          ? `/v2/bot/room/${s.roomId}/member/${user}`
          : `/v2/bot/profile/${user}`;
    const cached = profiles.get(route);
    if (cached) return cached;
    const p = await call<{ displayName?: string; pictureUrl?: string }>("GET", route).catch(() => undefined);
    const profile = { name: clean(p?.displayName ?? "").slice(0, 60) || "LINE user", picture: p?.pictureUrl };
    if (p) remember(profiles, route, profile);
    return profile;
  }

  /** A group or chat the bot is in, offered in the rooms picker. */
  async function sawRoom(s: Source): Promise<void> {
    const id = conversationOf(s);
    if (!id || groups.has(id)) return;
    const summary =
      s.type === "group"
        ? await call<{ groupName?: string }>("GET", `/v2/bot/group/${id}/summary`).catch(() => undefined)
        : undefined;
    const name = clean(summary?.groupName ?? "").slice(0, 80) || (s.type === "group" ? "LINE group" : "LINE chat");
    remember(groups, id, name);
    io?.room?.({ id, name });
  }

  /** A message's words: its text without the bot's own @mention, a sticker's keywords, or a note of what it is. */
  function textOf(m: LineMessage): { text: string; called: boolean; mentions: Array<{ id: string; handle: string }> } {
    const mentions: Array<{ id: string; handle: string }> = [];
    if (m.type === "sticker")
      return { text: m.keywords?.length ? m.keywords.join(", ") : "[sticker]", called: false, mentions };
    if (m.type === "location")
      return { text: `[location: ${[m.title, m.address].filter(Boolean).join(", ")}]`, called: false, mentions };
    if (m.type !== "text")
      return { text: m.type === "image" ? "" : `[${m.type ?? "message"}]`, called: false, mentions };
    let text = m.text ?? "";
    let called = false;
    const tags = [...(m.mention?.mentionees ?? [])].sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
    for (const t of tags) {
      const at = t.index ?? -1;
      const len = t.length ?? 0;
      if (at < 0 || !len) continue;
      if (t.isSelf) {
        called = true;
        text = text.slice(0, at) + text.slice(at + len);
      } else if (t.type === "user" && t.userId) {
        mentions.push({ id: t.userId, handle: text.slice(at, at + len).replace(/^@/, "") });
      }
    }
    return { text: text.replace(/\s+/g, " ").trim(), called, mentions };
  }

  async function onMessage(e: LineEvent & { message: LineMessage }, conversation: string, io: AdapterIO) {
    const s = e.source ?? {};
    const room = s.type === "group" || s.type === "room";
    if (room) await sawRoom(s);
    if (!s.userId || (room && !listed.has(conversation))) return;
    const m = e.message;
    const { text, called, mentions } = textOf(m);
    if (m.id && m.quoteToken) remember(quotes, m.id, m.quoteToken);
    let files: InboundFile[] = [];
    let failure = "";
    // Pictures are read in one-to-one chats only; a room answers words.
    if (!room && m.type === "image" && m.id && (m.contentProvider?.type ?? "line") === "line") {
      try {
        const f = await download(`${dataApi}/v2/bot/message/${m.id}/content`, MAX_IMAGE_BYTES, true);
        files = [{ name: `image.${f.mime.split("/")[1] ?? "jpg"}`, mime: f.mime, data: f.data.toString("base64") }];
      } catch (err) {
        failure = `[image could not be downloaded: ${err instanceof Error && err.message.startsWith("Attachment ") ? err.message : errorMessage(err, 100)}]`;
      }
    }
    const words = failure ? `${text}\n${failure}`.trim() : text;
    if (!words && !files.length) return;
    const p = await profileOf(s);
    io.receive({
      external_id: e.webhookEventId ?? m.id ?? "",
      ...(m.id ? { ref: m.id } : {}),
      conversation,
      sender: { id: s.userId, name: p.name },
      text: words,
      private: !room,
      ...(room ? { room: { called } } : {}),
      ...(mentions.length ? { mentions } : {}),
      ...(files.length ? { files } : {}),
    });
  }

  async function onEvent(e: LineEvent, io: AdapterIO): Promise<void> {
    // Another channel holds the chat (LINE's module mode): it answers, not the bot.
    if (e.mode === "standby") return;
    const s = e.source;
    const conversation = conversationOf(s);
    if (!s || !conversation) return;
    if (e.replyToken && !e.deliveryContext?.isRedelivery)
      remember(replyTokens, conversation, { token: e.replyToken, at: now() });
    if (e.type === "message" && e.message) return onMessage({ ...e, message: e.message }, conversation, io);
    if (e.type === "postback" && e.postback?.data && s.userId) {
      const room = s.type !== "user";
      if (room && !listed.has(conversation)) return;
      io.action({ conversation, sender: { id: s.userId, name: (await profileOf(s)).name }, data: e.postback.data });
      return;
    }
    if (e.type === "join") return sawRoom(s);
    if (e.type === "leave") {
      io.room?.({ id: conversation, name: groups.get(conversation) ?? conversation, left: true });
      groups.delete(conversation);
    }
    // "follow" (added as a friend) needs nothing: their first message starts the conversation.
  }

  /** The channel's public address comes and goes (it is the owner's to turn on): its state shown while it runs. */
  function checkAddress(): void {
    if (!io) return;
    const has = !!io.hookUrl?.();
    if (!has && !noAddress) io.status("error", NO_ADDRESS);
    else if (has && noAddress) io.status("running");
    noAddress = !has;
  }

  async function watchAddress(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await sleep(opts.addressEveryMs ?? ADDRESS_EVERY_MS, signal);
      checkAddress();
    }
  }

  /** The signature LINE puts on every delivery: base64 HMAC-SHA256 of the body with the channel secret. */
  function signed(req: HookRequest): boolean {
    if (!creds) return false;
    const given = Buffer.from(req.headers["x-line-signature"] ?? "", "base64");
    const want = createHmac("sha256", creds.secret).update(req.body).digest();
    return given.length === want.length && timingSafeEqual(given, want);
  }

  /** One call of up to five messages: the reply token's when it is fresh, else push. */
  async function deliver(to: string, messages: object[]): Promise<string | undefined> {
    const reply = replyTokens.get(to);
    replyTokens.delete(to);
    if (reply && now() - reply.at < REPLY_WINDOW_MS) {
      try {
        const r = await call<{ sentMessages?: Array<{ id?: string }> }>("POST", "/v2/bot/message/reply", {
          replyToken: reply.token,
          messages,
        });
        return r.sentMessages?.at(-1)?.id;
      } catch (err) {
        // A token LINE no longer takes sent nothing: push instead.
        if (!(err instanceof LineError && err.status === 400)) throw err;
      }
    }
    // Push counts against the account's monthly message quota (reply does not).
    const r = await call<{ sentMessages?: Array<{ id?: string }> }>("POST", "/v2/bot/message/push", { to, messages });
    return r.sentMessages?.at(-1)?.id;
  }

  return {
    caps: { typing: true, buttons: true },
    async start(adapterIO) {
      if (!creds)
        throw new ChannelRefused("LINE needs the channel secret (32 characters) and a long-lived channel access token");
      const bot = await call<{ displayName?: string; basicId?: string }>("GET", "/v2/bot/info").catch(
        (err: unknown) => {
          throw err instanceof LineError && (err.status === 401 || err.status === 403)
            ? new ChannelRefused(
                "LINE refused the channel access token: issue a new one in the LINE Developers console",
              )
            : err;
        },
      );
      io = adapterIO;
      checkAddress();
      watch = watchAddress(AbortSignal.any([ac.signal, adapterIO.signal]));
      return { account: bot.displayName || bot.basicId || "LINE" };
    },
    async stop() {
      ac.abort();
      await watch?.catch(() => {});
    },
    async forget() {
      fs.rmSync(stateFile, { force: true });
    },
    async webhook(req: HookRequest): Promise<HookResponse> {
      // Checked over the bytes as they came, before anything in them is read.
      if (!signed(req)) return { status: 401 };
      if (!io) return { status: 503 };
      checkAddress();
      let events: LineEvent[];
      try {
        const body = JSON.parse(req.body.toString("utf8")) as { events?: unknown };
        events = Array.isArray(body.events) ? (body.events as LineEvent[]) : [];
      } catch {
        return { status: 400 };
      }
      let fresh = false;
      for (const e of events) {
        // LINE delivers an event again when it heard no answer: each is handled once.
        if (e.webhookEventId && seen.has(e.webhookEventId)) continue;
        try {
          await onEvent(e, io);
        } catch {
          if (fresh) save();
          return { status: 500 };
        }
        if (e.webhookEventId) {
          seen.add(e.webhookEventId);
          fresh = true;
        }
      }
      if (fresh) {
        while (seen.size > MAX_SEEN) seen.delete(seen.values().next().value ?? "");
        save();
      }
      return { status: 200 };
    },
    // Files are left out: LINE fetches images from a public HTTPS URL, which the core does not have.
    async send(conversation, p) {
      const texts = p.text.trim() ? splitText(p.text, MAX_CHARS) : [];
      const quote = p.reply_to ? quotes.get(p.reply_to) : undefined;
      const quick = p.buttons?.length
        ? {
            items: p.buttons.slice(0, MAX_QUICK).map((b) => ({
              type: "action",
              action: { type: "postback", label: b.label.slice(0, MAX_LABEL), data: b.id, displayText: b.label },
            })),
          }
        : undefined;
      const messages = texts.map((text, i) => ({
        type: "text",
        text,
        ...(i === 0 && quote ? { quoteToken: quote } : {}),
        ...(i === texts.length - 1 && quick ? { quickReply: quick } : {}),
      }));
      const skip = p.skip ?? 0;
      let last: string | undefined;
      for (let i = skip; i < messages.length; i += PER_CALL) {
        try {
          last = (await deliver(conversation, messages.slice(i, i + PER_CALL))) ?? last;
        } catch (err) {
          throw toSendError(err, i - skip);
        }
      }
      return last === undefined ? {} : { external_id: last };
    },
    async typing(conversation) {
      // LINE shows it in one-to-one chats only (user ids start with "U").
      if (!conversation.startsWith("U")) return;
      await call("POST", "/v2/bot/chat/loading/start", { chatId: conversation, loadingSeconds: 20 });
    },
    async avatar(externalId) {
      const p = await profileOf({ type: "user", userId: externalId });
      if (!p.picture) return undefined;
      return download(p.picture, MAX_AVATAR_BYTES, false).catch(() => undefined);
    },
  };
}

function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof LineError) {
    if (err.status === 429) return new SendError("retry", msg, 5000, sent);
    // A server error may come after the message was accepted: never resent blindly.
    if (err.status >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  const code = causeCode(err);
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}
