// Telegram through the Bot API: long polling with plain fetch, no library. Updates are handed to the manager (which
// stores them) before the next poll confirms them to Telegram, so a crash never loses a message; a redelivery is
// dropped by the inbox's unique key. Groups are read only when the owner listed them (rooms, like Discord's); the Bot
// API cannot list a bot's groups, so the ones it is in are learned from updates and offered to pick from.
import { UPLOAD_LIMITS } from "@apx/protocol";
import type { Presentation } from "../domain/channels.ts";
import { errorMessage } from "../errors.ts";
import { causeCode, neverSent, sleep } from "./net.ts";
import { HANDLE } from "./rooms.ts";
import { chunks, toTelegramHtml } from "./telegram-format.ts";
import {
  type AdapterFactory,
  type AdapterIO,
  type ChannelAdapter,
  ChannelRefused,
  fileName,
  type InboundFile,
  type OutFile,
  SendError,
} from "./types.ts";

const POLL_S = 25;
const CALL_MS = 20_000;
const MAX_BACKOFF_MS = 60_000;
/** Voice notes up to this size are fetched for transcription (the Bot API serves files up to 20 MB). */
const MAX_VOICE_BYTES = 10 * 1024 * 1024;
const UPLOAD_MS = 60_000;

type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
type TgChat = { id: number; type: string; title?: string };
type TgEntity = { type: string; offset: number; length: number; user?: TgUser };
type TgMessage = {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  reply_to_message?: { from?: TgUser };
  photo?: Array<TgFile & { width: number; height: number }>;
  voice?: TgFile;
  audio?: TgFile;
  document?: TgFile & { file_name?: string };
  video?: TgFile & { file_name?: string };
  /** A GIF, which Telegram turns into a silent MP4. */
  animation?: TgFile & { file_name?: string };
  /** A round video message. */
  video_note?: TgFile;
  sticker?: TgFile & { is_animated?: boolean; is_video?: boolean; emoji?: string };
};
type TgFile = { file_id: string; mime_type?: string; file_size?: number };
type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
  message_reaction?: {
    chat: TgChat;
    message_id: number;
    user?: TgUser;
    new_reaction: Array<{ type: string; emoji?: string }>;
  };
  /** The bot was added to a chat, or removed from it. */
  my_chat_member?: { chat: TgChat; new_chat_member: { status: string } };
};

/** The chats that are groups (rooms); "channel" is a broadcast the bot only posts in. */
const GROUP_TYPES = new Set(["group", "supergroup"]);

/** The only emoji a bot may react with (the Bot API's standard reactions, written without variation selectors). */
export const TELEGRAM_REACTIONS: readonly string[] = (
  "❤ 👍 👎 🔥 🥰 👏 😁 🤔 🤯 😱 🤬 😢 🎉 🤩 🤮 💩 🙏 👌 🕊 🤡 🥱 🥴 😍 🐳 ❤\u200d🔥 🌚 🌭 💯 🤣 ⚡ 🍌 🏆 💔 🤨 😐 🍓 🍾 " +
  "💋 🖕 😈 😴 😭 🤓 👻 👨\u200d💻 👀 🎃 🙈 😇 😨 🤝 ✍ 🤗 🫡 🎅 🎄 ☃ 💅 🤪 🗿 🆒 💘 🙉 🦄 😘 💊 🙊 😎 👾 🤷\u200d♂ " +
  "🤷 🤷\u200d♀ 😡"
).split(" ");
const TG_ALLOWED = new Set(TELEGRAM_REACTIONS);

/** Stand-ins for emoji Telegram refuses (allowed one: the emoji it stands for); any other becomes a thumbs-up. */
const TG_CLOSEST: Record<string, string> = Object.fromEntries(
  Object.entries({
    "👏": "🙌",
    "👌": "✅ ✔ ☑ 🆗",
    "👍": "💪 👋 👆",
    "😁": "😀 😃 😄 😊 🙂 😉 😅",
    "🤣": "😆 😂",
    "🎉": "🥳 🎊",
    "🤩": "✨ 🌟 ⭐",
    "🥰": "🫶",
    "🙏": "🤞",
    "😱": "😮 😲",
    "🤔": "😕 🧐",
    "😢": "😞 😔 🥲",
    "😡": "😠",
    "🔥": "🚀",
    "❤": "💙 💚 💛 💜 🧡 🖤 🤍 💕 💖 💗 💞",
  }).flatMap(([to, from]) => from.split(" ").map((f) => [f, to])),
);

/** The allowed reaction closest to `emoji`, for when Telegram refuses it ("" stays "": it takes the reaction off). */
export function telegramReaction(emoji: string): string {
  const bare = emoji.replace(/\uFE0F/g, "");
  if (!bare || TG_ALLOWED.has(bare)) return bare;
  return TG_CLOSEST[bare] ?? "👍";
}
type TgReply<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

class TgError extends Error {
  readonly code: number;
  readonly retryAfter: number | undefined;
  constructor(code: number, message: string, retryAfter?: number) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** A sender's name as the owner sees it: what they call themselves plus their @username, short and on one line. */
function nameOf(u: TgUser | undefined): string {
  const name = [u?.first_name, u?.last_name]
    .filter(Boolean)
    .join(" ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, 60);
  const handle = u?.username ? `@${u.username}` : u ? `id ${u.id}` : "";
  return name ? `${name} (${handle})` : handle || "someone";
}

/** Telegram's limit for a file's caption. */
const CAPTION_MAX = 1024;

function mediaNote(m: TgMessage): string | undefined {
  const kind = m.photo
    ? "photo"
    : m.voice
      ? "voice note"
      : m.audio
        ? "audio"
        : m.video
          ? "video"
          : m.document
            ? "file"
            : m.sticker
              ? "sticker"
              : undefined;
  return kind ? `[${kind} — APX cannot read this kind of message yet]` : undefined;
}

/** The name and type a message's file is kept under (Telegram names few of them, and types not all). */
function fileKind(m: TgMessage, f: TgFile & { file_name?: string }): { name: string; mime: string } {
  if (m.photo?.length) return { name: "photo.jpg", mime: "image/jpeg" };
  if (m.sticker) {
    const [ext, type] = m.sticker.is_video
      ? ["webm", "video/webm"]
      : m.sticker.is_animated
        ? ["tgs", "application/x-tgsticker"]
        : ["webp", "image/webp"];
    return { name: `sticker.${ext}`, mime: type };
  }
  const video = m.video ?? m.animation ?? m.video_note;
  const fallback = video
    ? { name: "video.mp4", mime: "video/mp4" }
    : { name: "document", mime: "application/octet-stream" };
  return { name: f.file_name ?? fallback.name, mime: f.mime_type ?? fallback.mime };
}

/**
 * Whether a group message calls the bot: an @mention of it (or a command addressed to it), or a reply to one of its
 * messages. With Group Privacy on, these are the only group messages Telegram hands a bot at all.
 */
export function callsBot(m: TgMessage, me: { id: number; username?: string | undefined }): boolean {
  if (m.reply_to_message?.from?.id === me.id) return true;
  const text = m.text ?? m.caption ?? "";
  const handle = me.username ? `@${me.username.toLowerCase()}` : undefined;
  return (m.entities ?? m.caption_entities ?? []).some((e) => {
    if (e.type === "text_mention") return e.user?.id === me.id;
    const said = text.slice(e.offset, e.offset + e.length).toLowerCase();
    if (!handle) return false;
    return (e.type === "mention" && said === handle) || (e.type === "bot_command" && said.endsWith(handle));
  });
}

export const telegramAdapter = ((config, token, apiBase = "https://api.telegram.org"): ChannelAdapter => {
  const ac = new AbortController();
  let loop: Promise<void> | undefined;
  /** The bot itself, to know when a group message calls it. */
  let me: { id: number; username?: string | undefined } | undefined;
  const listed = new Set((config.rooms?.rooms ?? []).map((r) => r.id));

  async function api<T>(method: string, body: object, timeoutMs = CALL_MS, signal = ac.signal): Promise<T> {
    if (!token) throw new TgError(401, "no bot token");
    const res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    const j = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgReply<T>;
    if (!j.ok)
      throw new TgError(j.error_code ?? res.status, j.description ?? `HTTP ${res.status}`, j.parameters?.retry_after);
    return j.result as T;
  }

  /** A voice note or audio file's bytes, for transcription; none when it is too big to fetch. */
  async function voiceOf(m: TgMessage): Promise<{ mime: string; data: string } | undefined> {
    const v = m.voice ?? m.audio;
    if (!v?.file_id || (v.file_size ?? 0) > MAX_VOICE_BYTES) return undefined;
    const f = await api<{ file_path?: string }>("getFile", { file_id: v.file_id });
    if (!f.file_path) return undefined;
    const res = await fetch(`${apiBase}/file/bot${token}/${f.file_path}`, {
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(CALL_MS)]),
    });
    if (!res.ok) return undefined;
    return { mime: v.mime_type ?? "audio/ogg", data: Buffer.from(await res.arrayBuffer()).toString("base64") };
  }

  async function filesOf(m: TgMessage, signal = ac.signal): Promise<InboundFile[]> {
    const photo = [...(m.photo ?? [])].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const f = photo ?? m.document ?? m.video ?? m.animation ?? m.video_note ?? m.sticker;
    if (!f) return [];
    const { name, mime } = fileKind(m, f);
    const limit = mime.startsWith("image/") ? UPLOAD_LIMITS.imageBytes : UPLOAD_LIMITS.channelBytes;
    if ((f.file_size ?? 0) > limit) throw new Error("Attachment exceeds the upload size limit");
    const info = await api<{ file_path?: string }>("getFile", { file_id: f.file_id }, CALL_MS, signal);
    if (!info.file_path) throw new Error("Attachment is unavailable");
    const res = await fetch(`${apiBase}/file/bot${token}/${info.file_path}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_MS)]),
    });
    if (!res.ok || !res.body) throw new TgError(res.status, `Attachment download HTTP ${res.status}`);
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
    const data = Buffer.concat(chunks).toString("base64");
    return [{ name, mime, data, ...(m.sticker ? { sticker: { hint: m.sticker.emoji } } : {}) }];
  }

  async function readFiles(m: TgMessage): ReturnType<typeof filesOf> {
    const deadline = Date.now() + 90_000;
    const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(90_000)]);
    for (let attempt = 0; ; attempt++) {
      try {
        return await filesOf(m, signal);
      } catch (err) {
        const retryable =
          err instanceof TgError
            ? err.code === 429 || err.code >= 500
            : err instanceof TypeError || (err instanceof Error && ["TimeoutError", "AbortError"].includes(err.name));
        if (!retryable || attempt >= 2 || signal.aborted) throw err;
        const wait = err instanceof TgError && err.retryAfter ? err.retryAfter * 1000 : 250 * (attempt + 1);
        if (!Number.isFinite(wait) || Date.now() + wait + CALL_MS > deadline) throw err;
        await sleep(wait, signal);
      }
    }
  }

  function fileError(err: unknown): string {
    if (err instanceof TgError) return `Telegram HTTP ${err.code}`;
    if (err instanceof Error && err.message.startsWith("Attachment ")) return err.message;
    if (err instanceof Error && ["TimeoutError", "AbortError"].includes(err.name)) return "download timed out";
    const code = causeCode(err);
    return code && /^[A-Z0-9_]+$/.test(code) ? `connection failed (${code})` : "connection or download failed";
  }

  /** A group message: offered to pick, and handed over only from a listed group, as a room message. */
  function groupMessage(u: TgUpdate, m: TgMessage & { from: TgUser }, io: AdapterIO): void {
    const id = String(m.chat.id);
    io.room?.({ id, name: m.chat.title ?? id });
    const words = m.text ?? m.caption;
    if (!listed.has(id) || m.from.is_bot || !words?.trim()) return;
    // The @mention of the bot itself says nothing: it is how it was called.
    const own = me?.username ? new RegExp(`@${me.username}\\b`, "gi") : undefined;
    io.receive({
      external_id: String(u.update_id),
      ref: String(m.message_id),
      conversation: id,
      sender: {
        id: String(m.from.id),
        name: nameOf(m.from),
        ...(m.from.username ? { handle: m.from.username } : {}),
      },
      text: (own ? words.replace(own, "") : words).trim(),
      private: false,
      room: { called: me ? callsBot(m, me) : false },
    });
  }

  async function handle(u: TgUpdate, io: AdapterIO): Promise<void> {
    const joined = u.my_chat_member;
    if (joined && GROUP_TYPES.has(joined.chat.type)) {
      const id = String(joined.chat.id);
      const left = ["left", "kicked"].includes(joined.new_chat_member.status);
      io.room?.({ id, name: joined.chat.title ?? id, ...(left ? { left } : {}) });
      return;
    }
    const m = u.message;
    if (m?.from && GROUP_TYPES.has(m.chat.type)) return groupMessage(u, { ...m, from: m.from }, io);
    if (m?.from) {
      const private_ = m.chat.type === "private";
      // Downloads finish before the update is persisted and confirmed to Telegram.
      const voice = private_ ? await voiceOf(m).catch(() => undefined) : undefined;
      let files: Array<{ name: string; mime: string; data: string }> = [];
      let failure = "";
      if (private_ && (m.photo?.length || m.document || m.video || m.animation || m.video_note || m.sticker)) {
        try {
          files = await readFiles(m);
        } catch (err) {
          failure = `[attachment could not be downloaded: ${fileError(err)}]`;
        }
      }
      const words = m.text ?? m.caption ?? (voice || files.length ? "" : mediaNote(m));
      const text = failure ? `${words ?? ""}\n${failure}`.trim() : words;
      if (text === undefined) return;
      io.receive({
        external_id: String(u.update_id),
        ref: String(m.message_id),
        conversation: String(m.chat.id),
        sender: { id: String(m.from.id), name: nameOf(m.from) },
        text,
        private: private_,
        ...(voice ? { voice } : {}),
        ...(files.length ? { files } : {}),
      });
      return;
    }
    const r = u.message_reaction;
    if (r?.user) {
      io.reaction?.({
        conversation: String(r.chat.id),
        sender: { id: String(r.user.id), name: nameOf(r.user) },
        target: String(r.message_id),
        emoji: r.new_reaction.find((x) => x.type === "emoji")?.emoji ?? "",
        private: r.chat.type === "private",
      });
      return;
    }
    const q = u.callback_query;
    if (q?.data && q.message) {
      // The button stops spinning now; what its message shows next is up to the press (taken off, or ticked).
      void api("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
      io.action({
        conversation: String(q.message.chat.id),
        sender: { id: String(q.from.id), name: nameOf(q.from) },
        data: q.data,
        ref: String(q.message.message_id),
      });
    }
  }

  async function poll(io: AdapterIO): Promise<void> {
    let offset: number | undefined;
    let backoff = 1000;
    while (!ac.signal.aborted && !io.signal.aborted) {
      try {
        const updates = await api<TgUpdate[]>(
          "getUpdates",
          {
            ...(offset === undefined ? {} : { offset }),
            timeout: POLL_S,
            allowed_updates: ["message", "callback_query", "message_reaction", "my_chat_member"],
          },
          (POLL_S + 10) * 1000,
        );
        io.status("running");
        backoff = 1000;
        for (const u of updates) {
          await handle(u, io);
          // The next poll confirms only what was handed over (and stored).
          offset = u.update_id + 1;
        }
      } catch (err) {
        if (ac.signal.aborted || io.signal.aborted) return;
        const code = err instanceof TgError ? err.code : 0;
        if (code === 401 || code === 404) {
          io.status("error", "Telegram refused the bot token");
          return;
        }
        io.status(
          "error",
          code === 409
            ? "another program is reading this bot's messages (only one can)"
            : `cannot reach Telegram: ${errorMessage(err)}`.slice(0, 200),
        );
        const wait = code === 409 ? 30_000 : err instanceof TgError && err.retryAfter ? err.retryAfter * 1000 : backoff;
        await sleep(wait, AbortSignal.any([ac.signal, io.signal]));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  /**
   * An image as a photo, OGG/Opus as a voice note, other audio as an audio file, a sticker as a sticker, anything else
   * as a document.
   */
  async function sendFile(chat: string, f: OutFile, silent?: boolean, caption?: string): Promise<number> {
    const [method, field, name] =
      f.kind === "sticker"
        ? ["sendSticker", "sticker", fileName(f)]
        : f.kind === "file"
          ? ["sendDocument", "document", fileName(f)]
          : f.kind === "image"
            ? ["sendPhoto", "photo", "image"]
            : f.mime === "audio/ogg"
              ? ["sendVoice", "voice", "voice.ogg"]
              : ["sendAudio", "audio", `audio.${f.mime.split("/")[1] ?? "wav"}`];
    const form = new FormData();
    form.set("chat_id", chat);
    if (silent) form.set("disable_notification", "true");
    form.set(field, new Blob([new Uint8Array(f.data)], { type: f.mime }), name);
    if (caption && f.kind !== "sticker") form.set("caption", caption);
    if (!token) throw new TgError(401, "no bot token");
    const res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(UPLOAD_MS)]),
    });
    const j = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgReply<{
      message_id: number;
    }>;
    if (!j.ok)
      throw new TgError(j.error_code ?? res.status, j.description ?? `HTTP ${res.status}`, j.parameters?.retry_after);
    return (j.result as { message_id: number }).message_id;
  }

  async function sendOne(
    chat: string,
    text: string,
    buttons: Presentation["buttons"],
    silent?: boolean,
    replyTo?: string,
  ): Promise<number> {
    const markup = {
      ...(buttons?.length ? keyboard(buttons) : {}),
      ...(replyTo ? { reply_parameters: { message_id: Number(replyTo), allow_sending_without_reply: true } } : {}),
    };
    try {
      const r = await api<{ message_id: number }>("sendMessage", {
        chat_id: chat,
        text: toTelegramHtml(text),
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(silent ? { disable_notification: true } : {}),
        ...markup,
      });
      return r.message_id;
    } catch (err) {
      // Markup Telegram cannot parse: the same words as plain text.
      if (err instanceof TgError && err.code === 400 && /parse entities/i.test(err.message)) {
        const r = await api<{ message_id: number }>("sendMessage", {
          chat_id: chat,
          text,
          ...(silent ? { disable_notification: true } : {}),
          ...markup,
        });
        return r.message_id;
      }
      throw err;
    }
  }

  return {
    caps: { typing: true, buttons: true, reactions: true, stickers: true, reactionSet: TELEGRAM_REACTIONS },
    async start(io) {
      me = await api<{ id: number; username?: string }>("getMe", {}).catch((err: unknown) => {
        throw err instanceof TgError && (err.code === 401 || err.code === 404)
          ? new ChannelRefused("Telegram refused the bot token: check it with @BotFather")
          : err;
      });
      loop = poll(io);
      return { account: me.username ? `@${me.username}` : config.label };
    },
    async stop() {
      ac.abort();
      await loop?.catch(() => {});
    },
    async send(conversation, p, files = []) {
      // In a group, only the people the core named are pinged: any other @handle is written so it pings nobody.
      const named = new Set((p.mentions ?? []).map((x) => x.handle.toLowerCase()));
      const body = conversation.startsWith("-")
        ? p.text.replace(HANDLE, (raw, h: string) => (named.has(h.toLowerCase()) ? raw : `@\u200b${h}`))
        : p.text;
      // A voice note with its transcript: one message, the words as its caption (Telegram caps captions at 1024).
      const [only] = files;
      if (p.mediaFirst && only && files.length === 1 && body.trim().length <= CAPTION_MAX && !p.skip) {
        const id = await sendFile(conversation, only, p.silent, body.trim()).catch((err) => {
          throw toSendError(err, 0);
        });
        return { external_id: String(id) };
      }
      const texts = body.trim() ? chunks(body) : [];
      // Text parts first, then each file; `skip` counts across both.
      const steps: Array<() => Promise<number>> = [
        ...texts.map(
          (t, i) => () =>
            sendOne(
              conversation,
              t,
              i === texts.length - 1 ? p.buttons : undefined,
              p.silent,
              i === 0 ? p.reply_to : undefined,
            ),
        ),
        ...files.map((f) => () => sendFile(conversation, f, p.silent)),
      ];
      let last: number | undefined;
      for (let i = p.skip ?? 0; i < steps.length; i++) {
        try {
          last = await (steps[i] as () => Promise<number>)();
        } catch (err) {
          throw toSendError(err, i - (p.skip ?? 0));
        }
      }
      return last === undefined ? {} : { external_id: String(last) };
    },
    async avatar(userId) {
      const r = await api<{ photos?: Array<Array<{ file_id: string; width: number }>> }>("getUserProfilePhotos", {
        user_id: Number(userId),
        limit: 1,
      });
      // The smallest size that still reads well in a list.
      const sizes = [...(r.photos?.[0] ?? [])].sort((a, b) => a.width - b.width);
      const pick = sizes.find((x) => x.width >= 120) ?? sizes.at(-1);
      if (!pick) return undefined;
      const f = await api<{ file_path?: string }>("getFile", { file_id: pick.file_id });
      if (!f.file_path) return undefined;
      const res = await fetch(`${apiBase}/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(CALL_MS) });
      return res.ok ? { mime: "image/jpeg", data: Buffer.from(await res.arrayBuffer()) } : undefined;
    },
    async react(conversation, ref, emoji) {
      const put = (e: string) =>
        api(
          "setMessageReaction",
          { chat_id: Number(conversation), message_id: Number(ref), reaction: e ? [{ type: "emoji", emoji: e }] : [] },
          8000,
        );
      // The agent picks any emoji: it goes as chosen, and the closest allowed one only when Telegram refuses it.
      const bare = emoji.replace(/\uFE0F/g, "");
      const first = TG_ALLOWED.has(bare) ? bare : emoji;
      try {
        await put(first);
      } catch (err) {
        const closest = telegramReaction(emoji);
        if (!(err instanceof TgError && err.message.includes("REACTION_INVALID")) || closest === first) throw err;
        await put(closest);
      }
    },
    async setButtons(conversation, ref, buttons) {
      await api(
        "editMessageReplyMarkup",
        { chat_id: conversation, message_id: Number(ref), ...keyboard(buttons) },
        8000,
      );
    },
    async remove(conversation, ref) {
      // A bot may delete its own message only within 48 hours.
      await api("deleteMessage", { chat_id: conversation, message_id: Number(ref) }, 8000);
    },
    async typing(conversation) {
      await api("sendChatAction", { chat_id: conversation, action: "typing" }, 8000);
    },
  };
}) satisfies (...args: [...Parameters<AdapterFactory>, string?]) => ChannelAdapter;

/** Telegram's inline keyboard, one button per row (none: an empty keyboard takes them off). */
function keyboard(buttons: Presentation["buttons"]) {
  return {
    reply_markup: {
      inline_keyboard: (buttons ?? []).map((b) => [{ text: b.label, callback_data: b.id.slice(0, 64) }]),
    },
  };
}

/**
 * Maps a failure to what the outbox should do. `sent` parts of a long reply already went out: a retry continues after
 * them. Anything that may have reached Telegram is uncertain, never resent.
 */
function toSendError(err: unknown, sent: number): SendError {
  const msg = errorMessage(err);
  if (err instanceof TgError) {
    if (err.code === 429) return new SendError("retry", msg, (err.retryAfter ?? 5) * 1000, sent);
    if (err.code >= 500) return new SendError("uncertain", msg);
    return new SendError(sent ? "uncertain" : "fatal", msg);
  }
  if (neverSent(err)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}
