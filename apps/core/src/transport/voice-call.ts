import type { Server } from "node:http";
import { CallFrame } from "@apx/protocol";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import type { Calls, EngineEvent } from "../engine/calls.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { VoiceEngine } from "../services/voice-engine.ts";
import type { Gate } from "./guard.ts";

/** A call never outlives this: its deadline (AGENTS.md rule 9). */
const CALL_MAX_MS = 2 * 60 * 60_000;
const RECORDED = new Set(["heard", "said", "turn_end", "ask", "think", "think_stop"]);

/**
 * A call's audio both ways between the panel and the voice engine, plus its live state as JSON text frames. The
 * single-use ticket comes from the human-only `calls.start`; what the call says is written to its thread by `calls`,
 * which also runs the model the call talks with.
 */
export function attachVoiceCall(server: Server, deps: { calls: Calls; engine: VoiceEngine; gate: Gate; log: Log }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://core");
    if (url.pathname !== "/voice-call") return;
    if (!req.headers.origin || !deps.gate.allowedOrigins.has(req.headers.origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    let call: ReturnType<Calls["redeem"]>;
    try {
      call = deps.calls.redeem(url.searchParams.get("ticket") ?? "");
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (panel) => {
      void relay(panel, call);
      wss.emit("connection", panel, req);
    });
  });

  async function relay(panel: WebSocket, call: ReturnType<Calls["redeem"]>) {
    const tell = (f: CallFrame) => {
      if (panel.readyState === panel.OPEN) panel.send(JSON.stringify(f));
    };
    let engine: WebSocket | undefined;
    let ended = false;
    const end = (reason: string) => {
      if (ended) return;
      ended = true;
      clearTimeout(deadline);
      deps.calls.end(call.thread);
      tell({ type: "end", reason });
      panel.close();
      engine?.close();
    };
    const deadline = setTimeout(() => end("max_duration"), CALL_MAX_MS);
    deadline.unref();
    panel.on("message", (data, binary) => {
      if (binary) {
        if (engine?.readyState === engine?.OPEN) engine?.send(data, { binary: true });
        return;
      }
      try {
        if ((JSON.parse(String(data)) as { type?: string }).type === "hangup") end("hangup");
      } catch {}
    });
    panel.on("close", () => end("hangup"));
    panel.on("error", () => end("hangup"));

    if (deps.engine.loading()) tell({ type: "preparing" });
    try {
      // The first call on a computer that has not downloaded the voice yet waits for it.
      const stop = new AbortController();
      panel.once("close", () => stop.abort());
      await deps.engine.whenInstalled(stop.signal);
      engine = await deps.engine.open(call.setup);
    } catch (err) {
      deps.log.warn({ err: errorMessage(err, 300) }, "voice engine did not start");
      end("engine");
      return;
    }
    if (ended) {
      engine.close();
      return;
    }
    const link = engine;
    deps.calls.attach(
      call.thread,
      (f) => {
        if (link.readyState === link.OPEN) link.send(JSON.stringify(f));
      },
      () => end("hangup"),
    );
    link.on("message", (data, binary) => {
      if (binary) {
        if (panel.readyState !== panel.OPEN || panel.bufferedAmount > 4 * 1024 * 1024) return end("network");
        panel.send(data, { binary: true });
        return;
      }
      let e: { type?: string };
      try {
        e = JSON.parse(String(data));
      } catch {
        return;
      }
      if (RECORDED.has(e.type ?? "")) {
        deps.calls.hear(call.thread, e as EngineEvent);
        return;
      }
      const frame = CallFrame.safeParse(e);
      if (!frame.success) return;
      if (frame.data.type === "end") end(frame.data.reason);
      else tell(frame.data);
    });
    link.on("close", () => end("engine"));
    link.on("error", () => end("engine"));
  }

  return {
    close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
