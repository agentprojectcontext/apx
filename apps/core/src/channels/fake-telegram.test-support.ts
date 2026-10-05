// A Bot API server on localhost for tests: queues updates for getUpdates and records what the bot sends.
import http from "node:http";
import type { AddressInfo } from "node:net";

type Sent = { method: string; body: Record<string, unknown> };

export async function fakeTelegram(token: string) {
  const updates: Array<{ update_id: number } & Record<string, unknown>> = [];
  const sent: Sent[] = [];
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
        res.writeHead(200, { "content-type": "audio/ogg" });
        return res.end(Buffer.from("OggS-fake-voice"));
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
      if (method === "getFile") return reply(200, { ok: true, result: { file_path: "voice/1.oga" } });
      if (multipart) {
        const caption = /name="caption"\r\n\r\n([\s\S]*?)\r\n--/.exec(raw)?.[1];
        sent.push({ method, body: { bytes: raw.length, ...(caption ? { caption } : {}) } });
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
      sent.push({ method, body });
      if (method === "sendMessage") return reply(200, { ok: true, result: { message_id: nextMessage++ } });
      return reply(200, { ok: true, result: true });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const user = (id: number, first: string) => ({ id, first_name: first });
  return {
    url,
    sent,
    failures,
    message(from: { id: number; name: string }, text: string, chat: { id?: number; type?: string } = {}) {
      const update_id = nextUpdate++;
      updates.push({
        update_id,
        message: {
          message_id: update_id,
          chat: { id: chat.id ?? from.id, type: chat.type ?? "private" },
          from: user(from.id, from.name),
          text,
        },
      });
      return update_id;
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
    /** How many polls have been made (two pollers make twice as many). */
    polls: () => getUpdatesCalls,
    /** Update ids not confirmed yet by the bot. */
    queued: () => updates.map((u) => u.update_id),
    draftsTo(chat: number) {
      return sent.filter((s) => s.method === "sendMessageDraft" && String(s.body.chat_id) === String(chat));
    },
    messagesTo(chat: number) {
      return sent.filter((s) => s.method === "sendMessage" && String(s.body.chat_id) === String(chat));
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
