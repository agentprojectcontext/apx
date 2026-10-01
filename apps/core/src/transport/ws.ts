import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { ClientFrame, type HelloFrame, PROTOCOL_VERSION } from "@apx/protocol";
import { WebSocketServer } from "ws";
import type { Identity } from "../identity.ts";
import type { Log } from "../log.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import type { Dispatch } from "../rpc/router.ts";

export function attachWs(
  server: Server,
  deps: { dispatch: Dispatch; identity: Identity; log: Log; broker: NodeBroker },
) {
  const { dispatch, identity, log, broker } = deps;
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8 * 1024 * 1024 });

  wss.on("connection", (ws) => {
    let hello: HelloFrame | undefined;
    const session = randomUUID();

    ws.on("close", () => {
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
        hello = frame;
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
