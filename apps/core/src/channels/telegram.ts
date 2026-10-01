// Telegram through the Bot API: long polling with plain fetch, no library. Updates are handed to the manager (which
// stores them) before the next poll confirms them to Telegram, so a crash never loses a message; a redelivery is
// dropped by the inbox's unique key.
import type { Presentation } from "../domain/channels.ts";
import { errorMessage } from "../errors.ts";
import { chunks, toTelegramHtml } from "./telegram-format.ts";
import { type AdapterFactory, type AdapterIO, type ChannelAdapter, type OutFile, SendError } from "./types.ts";

const POLL_S = 25;
const CALL_MS = 20_000;
const MAX_BACKOFF_MS = 60_000;
/** Voice notes up to this size are fetched for transcription (the Bot API serves files up to 20 MB). */
const MAX_VOICE_BYTES = 10 * 1024 * 1024;
const UPLOAD_MS = 60_000;

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };
type TgChat = { id: number; type: string };
type TgMessage = {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: unknown;
  voice?: TgFile;
  audio?: TgFile;
  document?: unknown;
  video?: unknown;
  sticker?: unknown;
};
type TgFile = { file_id: string; mime_type?: string; file_size?: number };
type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
};
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

/** What a message without text was, so the agent can say it cannot read it yet. */
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

export const telegramAdapter = ((config, token, apiBase = "https://api.telegram.org"): ChannelAdapter => {
  const ac = new AbortController();
  let loop: Promise<void> | undefined;

  async function api<T>(method: string, body: object, timeoutMs = CALL_MS): Promise<T> {
    if (!token) throw new TgError(401, "no bot token");
    const res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([ac.signal, AbortSignal.timeout(timeoutMs)]),
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

  async function handle(u: TgUpdate, io: AdapterIO): Promise<void> {
    const m = u.message;
    if (m?.from) {
      const private_ = m.chat.type === "private";
      // Only one-to-one chats are read; a voice note is fetched now, before Telegram is told it arrived.
      const voice = private_ ? await voiceOf(m).catch(() => undefined) : undefined;
      const text = m.text ?? m.caption ?? (voice ? "" : mediaNote(m));
      if (text === undefined) return;
      io.receive({
        external_id: String(u.update_id),
        conversation: String(m.chat.id),
        sender: { id: String(m.from.id), name: nameOf(m.from) },
        text,
        private: private_,
        ...(voice ? { voice } : {}),
      });
      return;
    }
    const q = u.callback_query;
    if (q?.data && q.message) {
      // The button stops spinning now; its message loses its buttons so it cannot be pressed twice.
      void api("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
      void api("editMessageReplyMarkup", {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      io.action({
        conversation: String(q.message.chat.id),
        sender: { id: String(q.from.id), name: nameOf(q.from) },
        data: q.data,
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
            allowed_updates: ["message", "callback_query"],
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

  /** An image as a photo, OGG/Opus as a voice note, other audio as an audio file. */
  async function sendFile(chat: string, f: OutFile, silent?: boolean): Promise<number> {
    const [method, field, name] =
      f.kind === "image"
        ? ["sendPhoto", "photo", "image"]
        : f.mime === "audio/ogg"
          ? ["sendVoice", "voice", "voice.ogg"]
          : ["sendAudio", "audio", `audio.${f.mime.split("/")[1] ?? "wav"}`];
    const form = new FormData();
    form.set("chat_id", chat);
    if (silent) form.set("disable_notification", "true");
    form.set(field, new Blob([new Uint8Array(f.data)], { type: f.mime }), name);
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
  ): Promise<number> {
    const markup = buttons?.length
      ? { reply_markup: { inline_keyboard: buttons.map((b) => [{ text: b.label, callback_data: b.id.slice(0, 64) }]) } }
      : {};
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
    caps: { typing: true, buttons: true },
    async start(io) {
      const me = await api<{ username?: string }>("getMe", {}).catch((err: unknown) => {
        throw err instanceof TgError && (err.code === 401 || err.code === 404)
          ? new Error("Telegram refused the bot token: check it with @BotFather")
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
      const texts = p.text.trim() ? chunks(p.text) : [];
      // Text parts first, then each file; `skip` counts across both.
      const steps: Array<() => Promise<number>> = [
        ...texts.map(
          (t, i) => () => sendOne(conversation, t, i === texts.length - 1 ? p.buttons : undefined, p.silent),
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
    async typing(conversation) {
      await api("sendChatAction", { chat_id: conversation, action: "typing" }, 8000);
    },
  };
}) satisfies (...args: [...Parameters<AdapterFactory>, string?]) => ChannelAdapter;

/** Connection failures that happen before a request leaves this machine: the message surely did not go out. */
const NEVER_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);

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
  const code = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
  if (code && NEVER_SENT.has(code)) return new SendError("retry", msg, undefined, sent);
  return new SendError("uncertain", msg);
}

/** Waits, unless the adapter is stopped first. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
