// Nextcloud Talk on localhost for tests: the OCS calls its adapter makes (who am I, the conversations, the chat's
// long-poll, posting, reactions), plus a way for a test to write as someone and to read what the bot sent.
import http from "node:http";
import type { AddressInfo } from "node:net";

type Message = {
  id: number;
  token: string;
  actorType: string;
  actorId: string;
  actorDisplayName: string;
  message: string;
  messageType: string;
  systemMessage: string;
  timestamp: number;
  messageParameters: Record<string, object> | never[];
};

export type FakeNextcloud = {
  secret: string;
  /** Someone writes to the bot (their one-to-one conversation) or in `room`; `mention` @mentions the bot. Its id. */
  message(from: string, text: string, opts?: { room?: string; mention?: boolean; system?: boolean }): number;
  /** A group conversation the bot is in. */
  group(token: string, name: string): void;
  /** The token of `from`'s one-to-one conversation with the bot. */
  dm(from: string): string;
  sentTo(token: string): Array<{ text: string; replyTo?: number }>;
  reactions: Array<{ token: string; id: string; emoji: string; removed?: boolean }>;
  close(): Promise<void>;
};

export async function fakeNextcloud(): Promise<FakeNextcloud> {
  const USER = "apxbot";
  const PASSWORD = "Abcde-Fghij-Klmno-Pqrst-Uvwxy";
  const rooms = new Map<string, { type: number; displayName: string }>();
  const messages: Message[] = [];
  const sent: Array<{ token: string; text: string; replyTo?: number }> = [];
  const reactions: FakeNextcloud["reactions"] = [];
  const waiting = new Set<() => void>();
  let n = 100;
  const dm = (from: string) => `dm${from}`;
  const ocs = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ ocs: { meta: { status: status < 300 ? "ok" : "failure", statuscode: status }, data } }));
  };
  const body = (req: http.IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}));
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    const auth = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`;
    if (req.headers.authorization !== auth || req.headers["ocs-apirequest"] !== "true")
      return ocs(res, 401, { message: "Unauthorized" });
    if (p === "/ocs/v2.php/cloud/user") return ocs(res, 200, { id: USER, displayname: "APX" });
    if (p === "/ocs/v2.php/apps/spreed/api/v4/room")
      return ocs(
        res,
        200,
        [...rooms].map(([token, r]) => {
          const last = messages.filter((m) => m.token === token).at(-1);
          return { token, ...r, lastActivity: last?.timestamp ?? 0, lastMessage: last ? { id: last.id } : [] };
        }),
      );
    const chat = /^\/ocs\/v2\.php\/apps\/spreed\/api\/v1\/chat\/([^/]+)$/.exec(p);
    if (chat && req.method === "GET") {
      const token = decodeURIComponent(chat[1] ?? "");
      if (!rooms.has(token)) return ocs(res, 404, []);
      const after = Number(url.searchParams.get("lastKnownMessageId") ?? 0);
      const fresh = () => messages.filter((m) => m.token === token && m.id > after);
      if (!fresh().length)
        await new Promise<void>((r) => {
          const done = () => {
            waiting.delete(done);
            r();
          };
          waiting.add(done);
          setTimeout(done, 1200);
        });
      if (!fresh().length) {
        res.writeHead(304);
        return res.end();
      }
      return ocs(res, 200, fresh());
    }
    if (chat && req.method === "POST") {
      const b = await body(req);
      const token = decodeURIComponent(chat[1] ?? "");
      sent.push({ token, text: String(b.message ?? ""), ...(b.replyTo ? { replyTo: Number(b.replyTo) } : {}) });
      return ocs(res, 201, { id: n++ });
    }
    const reaction = /\/api\/v1\/reaction\/([^/]+)\/([^/]+)$/.exec(p);
    if (reaction) {
      const b = await body(req);
      const removed = req.method === "DELETE";
      const emoji = removed ? (url.searchParams.get("reaction") ?? "") : String(b.reaction ?? "");
      reactions.push({ token: reaction[1] ?? "", id: reaction[2] ?? "", emoji, ...(removed ? { removed } : {}) });
      return ocs(res, removed ? 200 : 201, {});
    }
    return ocs(res, 404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    secret: `${base} ${USER} ${PASSWORD}`,
    message(from, text, opts = {}) {
      const token = opts.room ?? dm(from);
      if (!rooms.has(token)) rooms.set(token, { type: 1, displayName: from });
      const id = n++;
      messages.push({
        id,
        token,
        actorType: "users",
        actorId: from,
        actorDisplayName: `${from.slice(0, 1).toUpperCase()}${from.slice(1)}`,
        message: opts.mention ? `{mention-user1} ${text}` : text,
        messageType: opts.system ? "system" : "comment",
        systemMessage: opts.system ? "call_started" : "",
        timestamp: Math.floor(Date.now() / 1000),
        messageParameters: opts.mention ? { "mention-user1": { type: "user", id: USER, name: "APX" } } : [],
      });
      for (const w of [...waiting]) w();
      return id;
    },
    group(token, name) {
      rooms.set(token, { type: 2, displayName: name });
    },
    dm,
    sentTo: (token) => sent.filter((s) => s.token === token).map(({ token: _, ...s }) => s),
    reactions,
    close: async () => {
      for (const w of [...waiting]) w();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
