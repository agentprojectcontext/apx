import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { ClientFrame, type HelloFrame, PROTOCOL_VERSION } from "@apx/protocol";
import { type WebSocket, WebSocketServer } from "ws";
import type { Bus } from "../bus.ts";
import type { Identity } from "../identity.ts";
import type { Log } from "../log.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import type { Dispatch } from "../rpc/router.ts";
import { type Gate, mayBeNode, refuse } from "./guard.ts";

export function attachWs(
  server: Server,
  deps: { dispatch: Dispatch; identity: Identity; log: Log; broker: NodeBroker; bus: Bus; gate: Gate },
) {
  const { dispatch, identity, log, broker, bus, gate } = deps;
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 8 * 1024 * 1024,
    verifyClient: ({ req }, done) => {
      const why = refuse(req, gate, new URL(req.url ?? "/", "http://core").searchParams.get("token"));
      if (why) log.warn({ origin: req.headers.origin, why }, "socket refused");
      done(!why, 403, why);
    },
  });
  const operators = new Set<WebSocket>();
  let seq = 0;
  // One stream for core events; a client that sees a seq gap refetches instead of expecting a replay.
  bus.on((event) => {
    const frame = JSON.stringify({ t: "event", stream: "core", seq: ++seq, type: event.type, payload: event });
    for (const ws of operators) if (ws.readyState === ws.OPEN) ws.send(frame);
  });

  wss.on("connection", (ws, req) => {
    const canBeNode = mayBeNode(req);
    let hello: HelloFrame | undefined;
    const session = randomUUID();

    ws.on("close", () => {
      operators.delete(ws);
      if (hello?.role === "node") {
        broker.detach(session);
        log.info({ session, node: hello.client.name }, "node disconnected");
      }
    });

    ws.on("message", async (data) => {
      let frame: ClientFrame;
      try {
        frame = ClientFrame.parse(JSON.parse(String(data)));
      } catch {
        ws.close(1008, "bad frame");
        return;
      }
      if (frame.t === "hello") {
        if (frame.protocol !== PROTOCOL_VERSION) {
          ws.close(1008, `protocol ${frame.protocol} unsupported (server speaks ${PROTOCOL_VERSION})`);
          return;
        }
        if (frame.role === "node" && !canBeNode) {
          ws.close(1008, "browser pages cannot register as nodes");
          return;
        }
        hello = frame;
        if (frame.role === "operator") operators.add(ws);
        if (frame.role === "node") {
          broker.attach({
            session,
            name: frame.client.name,
            caps: frame.caps,
            send: (f) => ws.send(JSON.stringify(f)),
          });
        }
        log.info({ session, role: frame.role, client: frame.client.name, caps: frame.caps }, "client connected");
        ws.send(
          JSON.stringify({
            t: "welcome",
            protocol: PROTOCOL_VERSION,
            session,
            server: { version: identity.version, code_sha: identity.code_sha },
          }),
        );
        return;
      }
      if (!hello) {
        ws.close(1008, "hello first");
        return;
      }
      if (frame.t === "res" || frame.t === "event") {
        // Only nodes answer core requests or push events; an operator sending these is ignored.
        if (hello.role !== "node") return;
        if (frame.t === "res") broker.settle(frame.id, frame);
        else broker.event(session, frame);
        return;
      }
      const out = await dispatch(
        frame.method,
        frame.params,
        { transport: "ws", role: hello.role, session, log },
        frame.idem,
      );
      ws.send(JSON.stringify({ t: "res", id: frame.id, ...out }));
    });
  });

  return wss;
}
