import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import { waitFor } from "../../../core/src/testkit/platform.ts";
import { nodeSocket } from "./node-socket.ts";

test("revoking a node closes its transport even when the peer never acknowledges a close frame", async () => {
  const peers = new Set<Duplex>();
  let peerClosed = false;
  const server = http.createServer();
  server.on("upgrade", (request, peer) => {
    peers.add(peer);
    peer.on("error", () => {});
    peer.on("end", () => peer.end());
    peer.on("close", () => {
      peerClosed = true;
      peers.delete(peer);
    });
    peer.on("data", () => {});
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    peer.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const socket = nodeSocket(`ws://127.0.0.1:${address.port}`);
  let closed = false;
  socket.addEventListener("close", () => {
    closed = true;
  });
  socket.addEventListener("error", () => {});
  try {
    await waitFor(() => socket.readyState === 1, "the node transport to open");
    socket.close();
    socket.close();
    await waitFor(() => closed && peerClosed, "both peers to finish without a closing handshake");
    assert.equal(socket.readyState, 3);
  } finally {
    socket.close();
    for (const peer of peers) peer.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a node can cancel its transport before the connection opens", async () => {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const socket = nodeSocket(`ws://127.0.0.1:${address.port}`);
  let closed = false;
  socket.addEventListener("close", () => {
    closed = true;
  });
  socket.addEventListener("error", () => {});
  try {
    socket.close();
    socket.close();
    await waitFor(() => closed, "the cancelled node transport to close");
    assert.equal(socket.readyState, 3);
  } finally {
    socket.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("revocation discards late replies before the deferred native teardown", async () => {
  const received: string[] = [];
  let peerClosed = false;
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (peer) => {
    peer.on("error", () => {});
    peer.on("message", (data) => received.push(data.toString()));
    peer.on("close", () => {
      peerClosed = true;
    });
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const socket = nodeSocket(`ws://127.0.0.1:${address.port}`);
  socket.addEventListener("error", () => {});
  try {
    await waitFor(() => socket.readyState === 1, "the reply transport to open");
    socket.send("Before revocation");
    await waitFor(() => received.length === 1, "the authorized reply to reach its peer");
    socket.close();
    socket.send("After revocation");
    await waitFor(() => socket.readyState === 3 && peerClosed, "the revoked reply transport to finish");
    assert.deepEqual(received, ["Before revocation"]);
  } finally {
    socket.close();
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("revocation during an incoming batch closes both peers without a native read error", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let peerClosed = false;
  server.on("connection", (peer) => {
    peer.on("error", () => {});
    peer.on("close", () => {
      peerClosed = true;
    });
    for (let i = 0; i < 100; i++) peer.send("Queued browser request");
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const socket = nodeSocket(`ws://127.0.0.1:${address.port}`);
  let messages = 0;
  socket.addEventListener("error", () => {});
  socket.addEventListener("message", () => {
    messages++;
    socket.close();
    assert.equal(socket.readyState, 2);
  });
  try {
    await waitFor(() => socket.readyState === 3 && peerClosed, "the revoked incoming transport to finish");
    assert.ok(messages > 0);
  } finally {
    socket.close();
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a core that refuses the node's token ends the transport without throwing", async () => {
  const server = http.createServer();
  server.on("upgrade", (_request, peer) => {
    peer.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const socket = nodeSocket(`ws://127.0.0.1:${address.port}`);
  let closed = false;
  let thrown: unknown;
  // The client closes its transport when it errors, as ApxClient does on a refused handshake.
  socket.addEventListener("error", () => {
    try {
      socket.close();
    } catch (error) {
      thrown = error;
    }
  });
  socket.addEventListener("close", () => {
    closed = true;
  });
  try {
    await waitFor(() => closed, "the refused transport to close");
    assert.equal(thrown, undefined);
    assert.equal(socket.readyState, 3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
