// Slack on localhost for tests: the Web API the app calls (auth.test, apps.connections.open, chat.postMessage…) and
// the Socket Mode socket that says hello and pushes the direct messages and button presses a test makes up. It
// records each envelope's acknowledgement.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

type Sent = { method: string; body: Record<string, unknown> };

export async function fakeSlack(tokens: { bot: string; app: string }) {
  const sent: Sent[] = [];
  const acked: string[] = [];
  /** Answers to force on the next calls of a method, in order. */
  const failures = new Map<string, Array<{ status: number; body: object; headers?: Record<string, string> }>>();
  let nextTs = 1000;
  let nextEnvelope = 1;
  let opens = 0;

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const method = (req.url ?? "").replace(/^\/api\//, "");
      const reply = (status: number, j: object, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(j));
      };
      if (method === "upload") {
        sent.push({ method: "upload", body: { bytes: raw.length } });
        return reply(200, { ok: true });
      }
      const auth = req.headers.authorization;
      const wants = method === "apps.connections.open" ? tokens.app : tokens.bot;
      if (auth !== `Bearer ${wants}`) return reply(200, { ok: false, error: "invalid_auth" });
      const forced = failures.get(method)?.shift();
      if (forced) return reply(forced.status, forced.body, forced.headers);
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      if (method === "auth.test") return reply(200, { ok: true, user: "apx", team: "Northwind" });
      if (method === "apps.connections.open") {
        opens++;
        return reply(200, { ok: true, url: socketUrl });
      }
      if (method === "users.info")
        return reply(200, {
          ok: true,
          user: { name: String(body.user).toLowerCase(), real_name: `User ${body.user}` },
        });
      sent.push({ method, body });
      if (method === "files.getUploadURLExternal")
        return reply(200, { ok: true, upload_url: `${api}/upload`, file_id: `F${nextTs++}` });
      return reply(200, { ok: true, ts: `${nextTs++}.0001` });
    });
  });

  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const sockets = new Set<import("ws").WebSocket>();
  wss.on("connection", (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("message", (raw) => {
      const f = JSON.parse(String(raw)) as { envelope_id?: string };
      if (f.envelope_id) acked.push(f.envelope_id);
    });
    ws.send(JSON.stringify({ type: "hello", num_connections: 1 }));
  });
  const push = (type: string, payload: object) => {
    const envelope_id = `env-${nextEnvelope++}`;
    for (const ws of sockets) ws.send(JSON.stringify({ type, envelope_id, payload }));
    return envelope_id;
  };

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => (wss.address() ? r() : wss.once("listening", () => r())));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const socketUrl = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  /** A person's direct-message conversation with the app. */
  const dm = (userId: string) => `D${userId}`;

  return {
    api,
    sent,
    failures,
    acked,
    dm,
    opens: () => opens,
    connections: () => sockets.size,
    /** A direct message to the app (or, with `channel`, a message somewhere else). */
    message(from: { id: string }, text: string, opts: { channel?: boolean; subtype?: string } = {}) {
      return push("events_api", {
        event: {
          type: "message",
          channel: opts.channel ? "C123" : dm(from.id),
          channel_type: opts.channel ? "channel" : "im",
          user: from.id,
          text,
          ts: `${nextTs++}.0002`,
          client_msg_id: `m-${nextTs}`,
          ...(opts.subtype ? { subtype: opts.subtype } : {}),
        },
      });
    },
    press(from: { id: string }, value: string, messageTs = "1.0001") {
      return push("interactive", {
        type: "block_actions",
        user: { id: from.id },
        channel: { id: dm(from.id) },
        container: { message_ts: messageTs, channel_id: dm(from.id) },
        actions: [{ action_id: "apx_0", value }],
      });
    },
    /** Slack asks the app to reconnect (it does so every few hours). */
    disconnect() {
      for (const ws of sockets) ws.send(JSON.stringify({ type: "disconnect", reason: "refresh_requested" }));
    },
    messagesTo(channel: string) {
      return sent.filter((s) => s.method === "chat.postMessage" && s.body.channel === channel);
    },
    close: async () => {
      for (const ws of sockets) ws.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
