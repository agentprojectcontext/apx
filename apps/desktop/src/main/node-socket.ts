import type { SocketTransport } from "@apx/protocol/client";
import WebSocket from "ws";

/** Revoking a native node cannot wait for the peer's closing handshake. */
export function nodeSocket(url: string): SocketTransport {
  const socket = new WebSocket(url);
  return {
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
    close: () => socket.terminate(),
    addEventListener: socket.addEventListener.bind(socket),
  };
}
