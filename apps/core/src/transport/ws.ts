import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import {
  ClientFrame,
  FILE_PAYLOAD_BYTES,
  type HelloFrame,
  methodAccess,
  methods,
  PROTOCOL_VERSION,
} from "@apx/protocol";
import { type WebSocket, WebSocketServer } from "ws";
import type { Bus } from "../bus.ts";
import type { Identity } from "../identity.ts";
import type { Log } from "../log.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import { type Dispatch, NODE_METHODS } from "../rpc/router.ts";
import { type Gate, localRequest, mayBeNode, refuse } from "./guard.ts";
import type { ClientLookup } from "./http.ts";

/** How an outside app's client token starts (domain/clients.ts). */
const CLIENT_TOKEN = "apxc_";

const MAX_PAYLOAD = FILE_PAYLOAD_BYTES;

/** What a connection may call, so the client does not have to guess. */
function methodsFor(hello: HelloFrame): string[] {
  if (hello.role === "node") return [...NODE_METHODS];
  return (Object.keys(methods) as Array<keyof typeof methods>).filter(
    (m) => hello.actor === "human" || methodAccess(m) !== "human",
  );
}

export function attachWs(
  server: Server,
  deps: {
    dispatch: Dispatch;
    identity: Identity;
    log: Log;
    broker: NodeBroker;
    bus: Bus;
    gate: Gate;
    deviceOf?: (token: string) => { id: string; name: string } | undefined;
    streamPath?: string | undefined;
    clientOf?: ClientLookup;
  },
) {
  const { dispatch, identity, log, broker, bus, gate } = deps;
  /** An outside app's client token: its client, or a refusal when it is unknown or revoked (as over HTTP). */
  const clientFor = (key: string | null) => (key?.startsWith(CLIENT_TOKEN) ? deps.clientOf?.(key) : undefined);
  const unknownClient = (key: string | null) => Boolean(key?.startsWith(CLIENT_TOKEN)) && !clientFor(key);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD,
    verifyClient: ({ req }, done) => {
      const key = new URL(req.url ?? "/", "http://core").searchParams.get("token");
      const why = unknownClient(key)
        ? "unknown or revoked client token"
        : refuse(req, gate, key, Boolean(clientFor(key)));
      if (why) log.warn({ origin: req.headers.origin, why }, "socket refused");
      done(!why, 403, why);
    },
  });
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://core").pathname;
    if (pathname !== "/ws") {
      if (pathname !== deps.streamPath) socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  const operators = new Map<WebSocket, (frame: string) => void>();
  let seq = 0;
  // One stream for core events; a client that sees a seq gap refetches instead of expecting a replay.
  bus.on((event) => {
    const frame = JSON.stringify({ t: "event", stream: "core", seq: ++seq, type: event.type, payload: event });
    for (const send of operators.values()) send(frame);
  });

  wss.on("connection", (ws, req) => {
    const canBeNode = mayBeNode(req);
    const key = new URL(req.url ?? "/", "http://core").searchParams.get("token");
    let hello: HelloFrame | undefined;
    const session = randomUUID();

    const detach = () => {
      operators.delete(ws);
      if (hello?.role === "node") broker.detach(session);
    };
    const allowed = () => {
      if (ws.readyState !== ws.OPEN) return false;
      if (!unknownClient(key) && !refuse(req, gate, key, Boolean(clientFor(key)))) return true;
      // Credentials can be revoked while a socket is open; remove capability access before closing it.
      detach();
      ws.close(1008, "missing or bad token");
      return false;
    };
    const send = (frame: object | string) => {
      if (allowed()) ws.send(typeof frame === "string" ? frame : JSON.stringify(frame));
    };

    ws.on("close", () => {
      detach();
      if (hello?.role === "node") log.info({ session, node: hello.client.name }, "node disconnected");
    });

    ws.on("message", async (data) => {
      if (!allowed()) return;
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
        if (frame.role === "node" && clientFor(key)) {
          ws.close(1008, "an outside app cannot register as a node");
          return;
        }
        // An outside app is a model, whatever its hello says it is.
        hello = clientFor(key) ? { ...frame, actor: "agent" } : frame;
        if (frame.role === "operator") operators.set(ws, send);
        if (frame.role === "node") {
          broker.attach({
            session,
            name: frame.client.name,
            caps: frame.caps,
            send,
          });
        }
        log.info({ session, role: frame.role, client: frame.client.name, caps: frame.caps }, "client connected");
        send({
          t: "welcome",
          protocol: PROTOCOL_VERSION,
          session,
          server: { version: identity.version, code_sha: identity.code_sha },
          methods: methodsFor(hello),
          limits: { max_payload: MAX_PAYLOAD },
          auth: { role: hello.role, actor: hello.actor },
        });
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
      const device = key?.startsWith("apxd_") ? deps.deviceOf?.(key) : undefined;
      const client = clientFor(key);
      const out = await dispatch(
        frame.method,
        frame.params,
        {
          transport: "ws",
          local: localRequest(req),
          role: hello.role,
          actor: hello.actor,
          ...(client ? { client } : {}),
          session,
          log,
          ...(device ? { device } : {}),
        },
        frame.idem,
      );
      send({ t: "res", id: frame.id, ...out });
    });
  });

  return wss;
}
