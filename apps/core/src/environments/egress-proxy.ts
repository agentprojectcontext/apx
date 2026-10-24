import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { publicHttp } from "./egress-http.ts";
import { type EgressPolicy, publicDestination, vmEgressPolicy } from "./egress-policy.ts";

type Dial = (address: string, port: number) => net.Socket;

/**
 * Sized for a package manager in the guest (dozens of parallel tunnels, each kept alive for many downloads), still
 * bounded: requests and tunnels at once (each holds one outbound socket), the guest's connections, an idle limit
 * longer than a client's keep-alive (so the client lets a tunnel go before the proxy does), and bytes per tunnel.
 */
export const EGRESS_LIMITS = {
  requests: 256,
  clients: 512,
  idleMs: 5 * 60_000,
  tunnelBytes: 4 * 1024 ** 3,
};
const BUSY = "HTTP/1.1 503 Service Unavailable\r\nRetry-After: 1\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

/** Host-owned endpoint reached only through a loopback SSH reverse forward in the guest. */
export async function createEgressProxy(
  policy: EgressPolicy = vmEgressPolicy(),
  dial: Dial = (host, port) => net.connect({ host, port }),
  limits = EGRESS_LIMITS,
) {
  let closed = false;
  let requests = 0;
  const reserve = (response: { once(event: "close", listener: () => void): unknown }) => {
    if (closed || requests >= limits.requests) return false;
    requests++;
    response.once("close", () => {
      requests--;
    });
    return true;
  };
  const clients = new Set<Duplex>();
  const remotes = new Set<Duplex>();
  const destinations = new Map<net.Socket, string>();
  const track = (socket: Duplex, into: Set<Duplex>) => {
    into.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      into.delete(socket);
      if (socket instanceof net.Socket) destinations.delete(socket);
    });
  };
  const connect = (address: string, port: number) => {
    if (closed || remotes.size >= limits.requests || !policy.allowed(address))
      throw new Error("destination is no longer public");
    const socket = dial(address, port);
    track(socket, remotes);
    destinations.set(socket, address);
    socket.setTimeout(limits.idleMs, () => socket.destroy());
    return socket;
  };
  const server = http.createServer(
    { maxHeaderSize: 16_384, requestTimeout: 30_000, headersTimeout: 10_000 },
    publicHttp(policy, connect, () => closed, reserve),
  );
  server.on("connection", (socket) => {
    if (clients.size >= limits.clients) {
      socket.destroy();
      return;
    }
    track(socket, clients);
    socket.setTimeout(limits.idleMs, () => socket.destroy());
  });
  server.on("connect", (req, client, head) => {
    // Busy, a tunnel is refused in words a package manager retries on, not with a reset.
    if (!reserve(client)) {
      client.end(BUSY);
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
            if (bytes > limits.tunnelBytes || !policy.allowed(address)) stop();
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
      for (const socket of [...clients, ...remotes]) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
