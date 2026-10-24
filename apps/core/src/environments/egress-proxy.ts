import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { publicHttp } from "./egress-http.ts";
import { type EgressPolicy, publicDestination, vmEgressPolicy } from "./egress-policy.ts";

type Dial = (address: string, port: number) => net.Socket;
const LIMIT = 64;

/** Host-owned endpoint reached only through a loopback SSH reverse forward in the guest. */
export async function createEgressProxy(
  policy: EgressPolicy = vmEgressPolicy(),
  dial: Dial = (host, port) => net.connect({ host, port }),
) {
  let closed = false;
  let requests = 0;
  const reserve = (response: { once(event: "close", listener: () => void): unknown }) => {
    if (closed || requests >= LIMIT) return false;
    requests++;
    response.once("close", () => {
      requests--;
    });
    return true;
  };
  const sockets = new Set<Duplex>();
  const destinations = new Map<net.Socket, string>();
  const track = (socket: Duplex) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      sockets.delete(socket);
      if (socket instanceof net.Socket) destinations.delete(socket);
    });
  };
  const connect = (address: string, port: number) => {
    if (closed || sockets.size >= LIMIT || !policy.allowed(address)) throw new Error("destination is no longer public");
    const socket = dial(address, port);
    track(socket);
    destinations.set(socket, address);
    socket.setTimeout(30_000, () => socket.destroy());
    return socket;
  };
  const server = http.createServer(
    { maxHeaderSize: 16_384, requestTimeout: 30_000, headersTimeout: 10_000 },
    publicHttp(policy, connect, () => closed, reserve),
  );
  server.on("connection", (socket) => {
    if (sockets.size >= LIMIT) {
      socket.destroy();
      return;
    }
    track(socket);
    socket.setTimeout(30_000, () => socket.destroy());
  });
  server.on("connect", (req, client, head) => {
    if (!reserve(client)) {
      client.destroy();
      return;
    }
    void (async () => {
      try {
        const { address, port, url } = await publicDestination(`https://${req.url ?? ""}`, policy);
        if (url.pathname !== "/" || url.search || url.hash) throw new Error("invalid tunnel authority");
        if (closed || client.destroyed) throw new Error("proxy closed");
        const remote = connect(address, port);
        const stop = () => {
          remote.destroy();
          client.destroy();
        };
        remote.on("error", stop);
        client.on("error", stop);
        client.on("close", () => remote.destroy());
        remote.on("close", () => client.destroy());
        let bytes = 0;
        for (const stream of [remote, client])
          stream.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 256 * 1024 * 1024 || !policy.allowed(address)) stop();
          });
        remote.once("connect", () => {
          if (!policy.allowed(address)) return stop();
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) remote.write(head);
          remote.pipe(client);
          client.pipe(remote);
        });
      } catch {
        client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      }
    })();
  });
  const refresh = setInterval(() => {
    for (const [socket, address] of destinations) if (!policy.allowed(address)) socket.destroy();
  }, 1000);
  refresh.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    clearInterval(refresh);
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("proxy failed to bind");
  return {
    port: address.port,
    async close() {
      closed = true;
      clearInterval(refresh);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
