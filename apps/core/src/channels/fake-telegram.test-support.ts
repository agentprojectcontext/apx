// A Bot API server on localhost for tests: queues updates for getUpdates and records what the bot sends.
import http from "node:http";
import type { AddressInfo } from "node:net";

type Sent = { method: string; body: Record<string, unknown>; message_id?: number };

export async function fakeTelegram(token: string) {
  const updates: Array<{ update_id: number } & Record<string, unknown>> = [];
  const sent: Sent[] = [];
  const files = new Map<string, { bytes: Buffer; mime: string }>();
  const downloads: string[] = [];
  /** Answers to force on the next calls of a method, in order; null lets that call through normally. */
  const failures = new Map<string, Array<{ status: number; body: object } | null>>();
  let nextUpdate = 1;
  let nextMessage = 100;
  let getUpdatesCalls = 0;

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const [, bot, method = ""] = (req.url ?? "").split("/");
      // A file download: /file/bot<token>/<path>.
      if (bot === "file") {
        const name = (req.url ?? "").split("/").at(-1) ?? "";
        downloads.push(name);
        const file = files.get(name);
        res.writeHead(200, { "content-type": file?.mime ?? "audio/ogg" });
        return res.end(file?.bytes ?? Buffer.from("OggS-fake-voice"));
      }
      const multipart = (req.headers["content-type"] ?? "").startsWith("multipart/");
      const body = (raw && !multipart ? JSON.parse(raw) : {}) as Record<string, unknown>;
      const reply = (status: number, j: object) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(j));
      };
      if (bot !== `bot${token}`) return reply(401, { ok: false, error_code: 401, description: "Unauthorized" });
      const forced = failures.get(method)?.shift();
      if (forced) return reply(forced.status, forced.body);
      if (method === "getMe") return reply(200, { ok: true, result: { id: 1, username: "apx_test_bot" } });
      if (method === "getFile")
        return reply(200, {
          ok: true,
          result: { file_path: files.has(String(body.file_id)) ? `uploads/${body.file_id}` : "voice/1.oga" },
        });
      if (multipart) {
        const caption = /name="caption"\r\n\r\n([\s\S]*?)\r\n--/.exec(raw)?.[1];
        const chat = /name="chat_id"\r\n\r\n([\s\S]*?)\r\n--/.exec(raw)?.[1];
        const filename = /filename="([^"]*)"/.exec(raw)?.[1];
        sent.push({
          method,
          body: {
            bytes: raw.length,
            ...(caption ? { caption } : {}),
            ...(chat ? { chat_id: chat } : {}),
            ...(filename ? { filename } : {}),
          },
        });
        return reply(200, { ok: true, result: { message_id: nextMessage++ } });
      }
      if (method === "getUpdates") {
        getUpdatesCalls++;
        const offset = Number(body.offset ?? 0);
        // Confirmed updates are dropped, like Telegram does.
        while (updates.length && (updates[0]?.update_id ?? 0) < offset) updates.shift();
        const take = () => reply(200, { ok: true, result: updates.filter((u) => u.update_id >= offset) });
        return updates.some((u) => u.update_id >= offset) ? take() : void setTimeout(take, 50);
      }
      const message_id = method === "sendMessage" ? nextMessage++ : undefined;
      sent.push({ method, body, ...(message_id ? { message_id } : {}) });
      if (message_id) return reply(200, { ok: true, result: { message_id } });
      return reply(200, { ok: true, result: true });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const user = (id: number, first: string, username?: string) => ({
    id,
    first_name: first,
    ...(username ? { username } : {}),
  });
  return {
    url,
    sent,
    failures,
    downloads,
    attachment(
      from: { id: number; name: string },
      file: {
        bytes: Buffer;
        mime: string;
        name?: string;
        photo?: boolean;
        /** Sent as a video (Telegram's own player), not as a document. */
        video?: boolean;
        /** Sent as a sticker, standing for this emoji. */
        sticker?: { emoji?: string };
        caption?: string;
        declaredSize?: number;
      },
    ) {
      const update_id = nextUpdate++;
      const file_id = `f${update_id}`;
      files.set(file_id, file);
      const item = { file_id, mime_type: file.mime, file_size: file.declaredSize ?? file.bytes.length };
      updates.push({
        update_id,
        message: {
          message_id: update_id,
          chat: { id: from.id, type: "private" },
          from: user(from.id, from.name),
          ...(file.caption !== undefined ? { caption: file.caption } : {}),
          ...(file.photo
            ? { photo: [{ ...item, width: 10, height: 10 }] }
            : file.sticker
              ? { sticker: { ...item, ...file.sticker } }
              : file.video
                ? { video: { ...item, ...(file.name ? { file_name: file.name } : {}) } }
                : { document: { ...item, file_name: file.name ?? "receipt.pdf" } }),
        },
      });
      return update_id;
    },
    /** `extra` goes into the message as is (entities, reply_to_message); a `username` gives the sender one. */
    message(
      from: { id: number; name: string; username?: string },
      text: string,
      chat: { id?: number; type?: string; title?: string } = {},
      extra: Record<string, unknown> = {},
    ) {
      const update_id = nextUpdate++;
      updates.push({
        update_id,
        message: {
          message_id: update_id,
          chat: { id: chat.id ?? from.id, type: chat.type ?? "private", ...(chat.title ? { title: chat.title } : {}) },
          from: user(from.id, from.name, from.username),
          text,
          ...extra,
        },
      });
      return update_id;
    },
    /** The bot was added to a group ("member") or removed from it ("left", "kicked"). */
    membership(chat: { id: number; title: string; type?: string }, status: string) {
      updates.push({
        update_id: nextUpdate++,
        my_chat_member: { chat: { type: "supergroup", ...chat }, new_chat_member: { status, user: user(1, "bot") } },
      });
    },
    voice(from: { id: number; name: string }) {
      const update_id = nextUpdate++;
      updates.push({
        update_id,
        message: {
          message_id: update_id,
          chat: { id: from.id, type: "private" },
          from: user(from.id, from.name),
          voice: { file_id: "v1", mime_type: "audio/ogg", file_size: 15 },
        },
      });
    },
    /** Redelivers an update as if the confirmation had been lost. */
    redeliver(update_id: number, from: { id: number; name: string }, text: string) {
      updates.push({
        update_id,
        message: {
          message_id: update_id,
          chat: { id: from.id, type: "private" },
          from: user(from.id, from.name),
          text,
        },
      });
    },
    press(from: { id: number; name: string }, data: string, messageId = 1) {
      updates.push({
        update_id: nextUpdate++,
        callback_query: {
          id: `cb${nextUpdate}`,
          from: user(from.id, from.name),
          data,
          message: { message_id: messageId, chat: { id: from.id, type: "private" } },
        },
      });
    },
    /** Someone puts an emoji on a message (none: takes theirs off). */
    react(from: { id: number; name: string }, messageId: number, emoji?: string) {
      updates.push({
        update_id: nextUpdate++,
        message_reaction: {
          chat: { id: from.id, type: "private" },
          message_id: messageId,
          user: user(from.id, from.name),
          new_reaction: emoji ? [{ type: "emoji", emoji }] : [],
        },
      });
    },
    /** The bot's reactions in a chat. */
    reactionsTo(chat: number) {
      return sent.filter((s) => s.method === "setMessageReaction" && String(s.body.chat_id) === String(chat));
    },
    /** How many polls have been made (two pollers make twice as many). */
    polls: () => getUpdatesCalls,
    /** Update ids not confirmed yet by the bot. */
    queued: () => updates.map((u) => u.update_id),
    messagesTo(chat: number) {
      return sent.filter((s) => s.method === "sendMessage" && String(s.body.chat_id) === String(chat));
    },
    /** Files sent to a chat (photos, voice notes, documents), with the method that sent each. */
    filesTo(chat: number) {
      return sent.filter(
        (s) => s.method !== "sendMessage" && s.body.filename && String(s.body.chat_id) === String(chat),
      );
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
