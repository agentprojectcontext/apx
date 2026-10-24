import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { Computer } from "../environments/computer.ts";
import { endViewer } from "../environments/guest-operations.ts";
import type { Gate } from "./guard.ts";
import { rfbInput } from "./rfb-input.ts";

/** Raw RFB bytes only; creating the single-use ticket requires the normal human-only router method. */
export function attachVmDisplay(server: Server, vm: Computer, gate: Gate) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://core");
    if (url.pathname !== "/vm-display") return;
    if (!req.headers.origin || !gate.allowedOrigins.has(req.headers.origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    try {
      const { screen, open } = vm.connectDisplay(url.searchParams.get("ticket") ?? "");
      wss.handleUpgrade(req, socket, head, (ws) => {
        const child = open();
        const stop = () => {
          endViewer(child);
          ws.terminate();
        };
        const deadline = setTimeout(stop, 30 * 60_000);
        deadline.unref();
        child.stdout?.on("data", (data: Buffer) => {
          if (ws.readyState !== ws.OPEN || ws.bufferedAmount > 4 * 1024 * 1024) return stop();
          ws.send(data);
        });
        const input = rfbInput(
          () => vm.humanControl(screen),
          (bytes) => child.stdin?.write(bytes),
        );
        ws.on("message", (data, binary) => {
          if (!binary || !child.stdin?.writable || child.stdin.writableLength > 1024 * 1024) return stop();
          try {
            input(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
          } catch {
            stop();
          }
        });
        ws.on("close", () => {
          clearTimeout(deadline);
          endViewer(child);
        });
        ws.on("error", stop);
        child.stdin?.on("error", stop);
        child.stdout?.on("error", stop);
        child.on("error", stop);
        child.on("close", () => {
          clearTimeout(deadline);
          ws.close();
        });
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  return {
    close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
