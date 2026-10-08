// Matrix, Mattermost and a signal-cli daemon on localhost for tests: just the calls their adapters make, plus a way
// for a test to write as someone and to read what the agent sent. One shape for the three, so one suite drives them.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

export type FakeBridge = {
  /** The channel's secret: the fake server's address and its token or number. */
  secret: string;
  /** A one-to-one message from `from`; `group` puts it somewhere the agent must not read. */
  message(from: string, text: string, opts?: { group?: boolean }): void;
  /** Texts the agent sent to `to` (their direct conversation). */
  sentTo(to: string): string[];
  close(): Promise<void>;
};

const listen = async (server: http.Server) => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const body = (req: http.IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}));
  });
const json = (res: http.ServerResponse, status: number, j: object) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(j));
};

export async function fakeMatrix(): Promise<FakeBridge> {
  const TOKEN = "syt_fake_matrix_token_1234";
  const sent: Array<{ room: string; text: string }> = [];
  let queue: Array<{ room: string; members: number; ev: object }> = [];
  let waiting: (() => void) | undefined;
  let n = 1;
  const dm = (user: string) => `!dm-${user}`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.headers.authorization !== `Bearer ${TOKEN}`)
      return json(res, 401, { errcode: "M_UNKNOWN_TOKEN", error: "bad token" });
    const p = url.pathname;
    if (p.endsWith("/account/whoami")) return json(res, 200, { user_id: "@apx:example.org" });
    if (p.includes("/profile/")) return json(res, 200, { displayname: "Someone" });
    if (p.endsWith("/sync")) {
      if (!queue.length)
        await new Promise<void>((r) => {
          waiting = r;
          setTimeout(r, 300);
        });
      const batch = queue;
      queue = [];
      const join: Record<string, object> = {};
      for (const q of batch) {
        const room = (join[q.room] ?? {
          summary: { "m.joined_member_count": q.members },
          timeline: { events: [] as object[] },
        }) as { timeline: { events: object[] } };
        room.timeline.events.push(q.ev);
        join[q.room] = room;
      }
      return json(res, 200, { next_batch: `s${n++}`, rooms: { join } });
    }
    const send = /\/rooms\/([^/]+)\/send\/m\.room\.message\//.exec(p);
    if (send && req.method === "PUT") {
      const b = await body(req);
      sent.push({ room: decodeURIComponent(send[1] ?? ""), text: String(b.body ?? "") });
      return json(res, 200, { event_id: `$out${n++}` });
    }
    return json(res, 200, {});
  });
  const base = await listen(server);
  return {
    secret: `${base} ${TOKEN}`,
    message(from, text, opts = {}) {
      const ev = {
        type: "m.room.message",
        event_id: `$in${n++}`,
        sender: `@${from}:example.org`,
        origin_server_ts: Date.now(),
        content: { msgtype: "m.text", body: text },
      };
      queue.push({ room: opts.group ? "!group" : dm(from), members: opts.group ? 5 : 2, ev });
      waiting?.();
    },
    sentTo: (to) => sent.filter((s) => s.room === dm(to)).map((s) => s.text),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export async function fakeMattermost(): Promise<FakeBridge> {
  const TOKEN = "fakemattermosttoken0000001";
  const sent: Array<{ channel: string; text: string }> = [];
  let n = 1;
  const dm = (user: string) => `dm-${user}`;
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { message: "bad token" });
    if (req.url === "/api/v4/users/me") return json(res, 200, { id: "bot1", username: "apx" });
    if (req.url === "/api/v4/posts" && req.method === "POST") {
      const b = await body(req);
      sent.push({ channel: String(b.channel_id), text: String(b.message ?? "") });
      return json(res, 201, { id: `p${n++}` });
    }
    return json(res, 404, { message: "not found" });
  });
  const wss = new WebSocketServer({ server, path: "/api/v4/websocket" });
  const sockets = new Set<import("ws").WebSocket>();
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const f = JSON.parse(String(raw)) as { seq?: number; action?: string; data?: { token?: string } };
      if (f.action === "authentication_challenge" && f.data?.token === TOKEN) {
        sockets.add(ws);
        ws.send(JSON.stringify({ status: "OK", seq_reply: f.seq }));
      }
    });
    ws.on("close", () => sockets.delete(ws));
  });
  const base = await listen(server);
  return {
    secret: `${base} ${TOKEN}`,
    message(from, text, opts = {}) {
      const post = {
        id: `in${n++}`,
        user_id: `u-${from}`,
        channel_id: opts.group ? "town" : dm(`u-${from}`),
        message: text,
      };
      const ev = {
        event: "posted",
        data: { post: JSON.stringify(post), channel_type: opts.group ? "O" : "D", sender_name: `@${from}` },
      };
      for (const ws of sockets) ws.send(JSON.stringify(ev));
    },
    sentTo: (to) => sent.filter((s) => s.channel === dm(`u-${to}`)).map((s) => s.text),
    close: async () => {
      for (const ws of sockets) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export async function fakeSignal(): Promise<FakeBridge> {
  const ACCOUNT = "+15550000001";
  const sent: Array<{ to: string; text: string }> = [];
  const streams = new Set<http.ServerResponse>();
  let ts = 1_700_000_000_000;
  const numberOf = (who: string) => `+1555${String(who.length).padStart(3, "0")}${who.charCodeAt(0)}`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/api/v1/check") return json(res, 200, {});
    if (url.pathname === "/api/v1/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(":\n\n");
      streams.add(res);
      req.on("close", () => streams.delete(res));
      return;
    }
    if (url.pathname === "/api/v1/rpc") {
      const b = (await body(req)) as {
        id?: string;
        method?: string;
        params?: { recipient?: string[]; message?: string };
      };
      if (b.method === "send") sent.push({ to: b.params?.recipient?.[0] ?? "", text: b.params?.message ?? "" });
      return json(res, 200, { jsonrpc: "2.0", id: b.id, result: { timestamp: ts++ } });
    }
    return json(res, 404, {});
  });
  const base = await listen(server);
  return {
    secret: `${base} ${ACCOUNT}`,
    message(from, text, opts = {}) {
      const envelope = {
        sourceNumber: numberOf(from),
        sourceName: from,
        timestamp: ts,
        dataMessage: { message: text, timestamp: ts++, ...(opts.group ? { groupInfo: { groupId: "g1" } } : {}) },
      };
      for (const s of streams) s.write(`data:${JSON.stringify({ envelope, account: ACCOUNT })}\n\n`);
    },
    sentTo: (to) => sent.filter((s) => s.to === numberOf(to)).map((s) => s.text),
    close: async () => {
      for (const s of streams) s.end();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
