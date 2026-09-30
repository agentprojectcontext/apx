import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { ClientFrame, type HelloFrame, PROTOCOL_VERSION } from "@apx/protocol";
import { WebSocketServer } from "ws";
import type { Identity } from "../identity.ts";
import type { Log } from "../log.ts";
import type { Dispatch } from "../rpc/router.ts";

export function attachWs(server: Server, dispatch: Dispatch, identity: Identity, log: Log) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4 * 1024 * 1024 });

  wss.on("connection", (ws) => {
    let hello: HelloFrame | undefined;
    const session = randomUUID();

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
