import type { SocketTransport } from "@apx/protocol/client";
import WebSocket from "ws";

/** Revoking a native node cannot wait for the peer's closing handshake. */
export function nodeSocket(url: string): SocketTransport {
  const socket = new WebSocket(url);
  let closing = false;
  return {
    get readyState() {
      return closing && socket.readyState !== WebSocket.CLOSED ? WebSocket.CLOSING : socket.readyState;
    },
    send: (data) => {
      if (!closing) socket.send(data);
    },
    close: () => {
      if (closing) return;
      closing = true;
      // A refused or failed handshake has no stream to pause: ws reports it as closing with none attached.
      if (socket.readyState !== WebSocket.OPEN) {
        socket.terminate();
        return;
      }
      // Drain the current read turn before destruction; late reads must not reach a destroyed native stream.
      socket.pause();
      setImmediate(() => socket.terminate());
    },
    addEventListener: socket.addEventListener.bind(socket),
  };
}
