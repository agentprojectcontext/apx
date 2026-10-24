import http from "node:http";
import type net from "node:net";
import { type EgressPolicy, publicDestination } from "./egress-policy.ts";

export type Admission = (response: { once(event: "close", listener: () => void): unknown }) => boolean;
export function publicHttp(
  policy: EgressPolicy,
  connect: (address: string, port: number) => net.Socket,
  closed: () => boolean,
  reserve: Admission,
): http.RequestListener {
  return (req, res) => {
    if (!reserve(res)) {
      res.writeHead(503, { "retry-after": "1" }).end();
      return;
    }
    void (async () => {
      try {
        const { url, address, port } = await publicDestination(req.url ?? "", policy);
        if (url.protocol !== "http:") throw new Error("use CONNECT for HTTPS");
        const headers: http.OutgoingHttpHeaders = { ...req.headers, host: url.host };
        const hopHeaders = String(req.headers.connection ?? "")
          .split(",")
          .map((key) => key.trim().toLowerCase());
        for (const key of [
          ...hopHeaders,
          "proxy-authorization",
          "proxy-connection",
          "connection",
          "upgrade",
          "keep-alive",
          "te",
          "trailer",
        ])
          delete headers[key];
        if (closed() || req.destroyed) throw new Error("proxy closed");
        const agent = new http.Agent();
        agent.createConnection = () => connect(address, port);
        const remote = http.request(
          {
            hostname: address,
            port,
            method: req.method,
            path: url.pathname + url.search,
            headers,
            agent,
          },
          (reply) => {
            res.writeHead(reply.statusCode ?? 502, reply.headers);
            reply.pipe(res);
          },
        );
        let bytes = 0;
        req.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024 || !policy.allowed(address)) remote.destroy(new Error("egress request refused"));
        });
        remote.on("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        res.on("close", () => {
          remote.destroy();
          agent.destroy();
        });
        req.pipe(remote);
      } catch {
        res.writeHead(403).end("Destination refused");
      }
    })();
  };
}
