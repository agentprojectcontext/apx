// Discord on localhost for tests: the REST API the bot calls and a Gateway socket that says hello, takes the bot's
// identify and heartbeats, and dispatches the direct messages and button presses a test makes up.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

type Sent = { method: string; route: string; body: Record<string, unknown> };

export async function fakeDiscord(token: string) {
  const sent: Sent[] = [];
  const identified: Array<{ intents: number }> = [];
  /** Answers to force on the next calls of a route (method + path), in order. */
  const failures = new Map<string, Array<{ status: number; body: object }>>();
  let nextId = 900;
  let seq = 0;
  let nextDm = 5000;
  const dmOf = new Map<string, string>();

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const route = (req.url ?? "").replace(/^\/api\/v10/, "");
      const reply = (status: number, j?: object) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(j ? JSON.stringify(j) : undefined);
      };
      // Interaction callbacks carry their own token, not the bot's.
      if (route.startsWith("/interactions/")) {
        sent.push({ method: "callback", route, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} });
        return reply(204);
      }
      if (req.headers.authorization !== `Bot ${token}`) return reply(401, { message: "401: Unauthorized", code: 0 });
      const forced = failures.get(`${req.method} ${route}`)?.shift();
      if (forced) return reply(forced.status, forced.body);
      if (req.method === "GET" && route === "/users/@me") return reply(200, { id: "1", username: "apx_test_bot" });
      if (req.method === "GET" && route.startsWith("/users/")) return reply(200, { id: route.slice(7), avatar: null });
      const multipart = (req.headers["content-type"] ?? "").startsWith("multipart/");
      const body = (raw && !multipart ? JSON.parse(raw) : multipart ? { bytes: raw.length } : {}) as Record<
        string,
        unknown
      >;
      sent.push({ method: req.method ?? "", route, body });
      if (route.endsWith("/typing")) return reply(204);
      return reply(200, { id: String(nextId++) });
    });
  });

  const gateway = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const sockets = new Set<import("ws").WebSocket>();
  gateway.on("connection", (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 } }));
    ws.on("message", (raw) => {
      const f = JSON.parse(String(raw)) as { op: number; d?: { token?: string; intents?: number } };
      if (f.op === 1) ws.send(JSON.stringify({ op: 11 }));
      if (f.op === 2) {
        if (f.d?.token !== token) return ws.close(4004, "Authentication failed");
        identified.push({ intents: f.d.intents ?? 0 });
        ws.send(JSON.stringify({ op: 0, s: ++seq, t: "READY", d: { user: { id: "1", username: "apx_test_bot" } } }));
      }
    });
  });
  const dispatch = (t: string, d: object) => {
    for (const ws of sockets) ws.send(JSON.stringify({ op: 0, s: ++seq, t, d }));
  };

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => (gateway.address() ? r() : gateway.once("listening", () => r())));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v10`;
  const gatewayUrl = `ws://127.0.0.1:${(gateway.address() as AddressInfo).port}`;

  /** A user's direct-message channel with the bot (one per user). */
  const dm = (userId: string) => {
    const known = dmOf.get(userId);
    if (known) return known;
    const id = String(nextDm++);
    dmOf.set(userId, id);
    return id;
  };
  const author = (from: { id: string; name: string }) => ({ id: from.id, username: from.name.toLowerCase() });

  return {
    urls: { api, gateway: gatewayUrl, cdn: api },
    sent,
    failures,
    identified,
    dm,
    /** A direct message to the bot (or, with `guild`, a message in a server's channel). */
    message(from: { id: string; name: string }, content: string, opts: { guild?: boolean; bot?: boolean } = {}) {
      dispatch("MESSAGE_CREATE", {
        id: String(nextId++),
        channel_id: opts.guild ? "777" : dm(from.id),
        ...(opts.guild ? { guild_id: "42" } : {}),
        author: { ...author(from), ...(opts.bot ? { bot: true } : {}) },
        content,
      });
    },
    press(from: { id: string; name: string }, customId: string) {
      dispatch("INTERACTION_CREATE", {
        id: String(nextId++),
        token: "itoken",
        type: 3,
        channel_id: dm(from.id),
        user: author(from),
        data: { custom_id: customId },
      });
    },
    /** Drops every Gateway connection, as Discord does now and then. */
    drop() {
      for (const ws of sockets) ws.close(4000, "reconnect");
    },
    connections: () => sockets.size,
    messagesTo(channel: string) {
      return sent.filter((s) => s.method === "POST" && s.route === `/channels/${channel}/messages`);
    },
    close: async () => {
      for (const ws of sockets) ws.terminate();
      await new Promise<void>((r) => gateway.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
