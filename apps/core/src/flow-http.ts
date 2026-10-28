// An HTTP step's one request (DECISIONS.md#d-169). The name is resolved once and every address must be public (the
// egress policy agents' computers use); the socket connects to that checked address, never to a second lookup, and
// is checked again once connected. Redirects are not followed. Nothing is written before `onSend` commits that the
// request may reach the service, so a crash before it leaves the step safe to run again.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { TLSSocket } from "node:tls";
import { type EgressPolicy, vmEgressPolicy } from "./environments/egress-policy.ts";

/** Most bytes of an answer read; the rest is cut and said so. */
export const FLOW_HTTP_READ = 256 * 1024;
const LOOKUP_MS = 5000;

/** Where a request stopped: refused before going out, not sent (safe to try again), or sent with no answer. */
export class FlowHttpError extends Error {
  readonly stage: "refused" | "unsent" | "sent";
  constructor(stage: "refused" | "unsent" | "sent") {
    super(`flow request ${stage}`);
    this.stage = stage;
  }
}

export type FlowHttpPolicy = EgressPolicy & {
  /** Exact `host:port` destinations a test lets through though they are not public. Empty in a real core. */
  allow?: ((host: string, port: number) => boolean) | undefined;
};
export const flowHttpPolicy = (allow?: readonly string[]): FlowHttpPolicy => ({
  ...vmEgressPolicy(),
  ...(allow?.length ? { allow: (host: string, port: number) => allow.includes(`${host}:${port}`) } : {}),
});

export type FlowHttpAnswer = {
  status: number;
  headers: http.IncomingHttpHeaders;
  bytes: Buffer;
  truncated: boolean;
};

async function resolve(host: string, policy: FlowHttpPolicy, port: number) {
  const version = net.isIP(host);
  let addresses: { address: string; family: number }[];
  if (version) addresses = [{ address: host, family: version }];
  else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      addresses = await Promise.race([
        policy.lookup(host),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("lookup timed out")), LOOKUP_MS);
        }),
      ]);
    } catch {
      throw new FlowHttpError("unsent");
    } finally {
      clearTimeout(timer);
    }
  }
  if (!addresses.length) throw new FlowHttpError("unsent");
  const ok = (a: string) => policy.allowed(a) || Boolean(policy.allow?.(host, port));
  // Every address the name has must be public: one inside is enough to refuse it.
  if (addresses.some(({ address }) => !ok(address))) throw new FlowHttpError("refused");
  const picked = addresses.find((a) => a.family === 4) ?? addresses[0];
  if (!picked) throw new FlowHttpError("unsent");
  return { ...picked, ok };
}

export async function flowHttpRequest(
  request: { method: "GET" | "POST" | "PUT"; url: string; headers: Record<string, string>; body?: string },
  o: { policy: FlowHttpPolicy; signal: AbortSignal; onSend: () => boolean; maxBytes?: number },
): Promise<FlowHttpAnswer> {
  const url = new URL(request.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new FlowHttpError("refused");
  const secure = url.protocol === "https:";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port || (secure ? 443 : 80));
  const pinned = await resolve(host, o.policy, port);
  if (o.signal.aborted) throw new FlowHttpError("unsent");
  const maxBytes = o.maxBytes ?? FLOW_HTTP_READ;
  return new Promise<FlowHttpAnswer>((done, fail) => {
    let sent = false;
    let settled = false;
    const finish = (err: FlowHttpError | undefined, answer?: FlowHttpAnswer) => {
      if (settled) return;
      settled = true;
      o.signal.removeEventListener("abort", abort);
      if (err) fail(err);
      else if (answer) done(answer);
    };
    const body = request.body === undefined ? undefined : Buffer.from(request.body, "utf8");
    const req = (secure ? https : http).request({
      method: request.method,
      hostname: host,
      port,
      path: `${url.pathname}${url.search}`,
      headers: { ...request.headers, ...(body ? { "content-length": String(body.length) } : {}) },
      agent: false,
      // The address checked above, whatever the name says now.
      lookup: ((_name: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) =>
        opts?.all
          ? cb(null, [{ address: pinned.address, family: pinned.family }])
          : cb(null, pinned.address, pinned.family)) as unknown as net.LookupFunction,
      ...(secure ? { servername: net.isIP(host) ? undefined : host } : {}),
    });
    const abort = () => req.destroy(new Error("aborted"));
    o.signal.addEventListener("abort", abort, { once: true });
    req.on("socket", (socket) => {
      const ready = () => {
        // Checked again on the socket itself; then the step commits that the request may reach the service.
        if (!socket.remoteAddress || !pinned.ok(socket.remoteAddress)) {
          req.destroy();
          finish(new FlowHttpError("refused"));
          return;
        }
        let go = false;
        try {
          go = o.onSend();
        } catch {}
        if (!go) {
          req.destroy();
          finish(new FlowHttpError("unsent"));
          return;
        }
        sent = true;
        req.end(body);
      };
      if (secure) (socket as TLSSocket).once("secureConnect", ready);
      else socket.once("connect", ready);
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      const answer = () => ({
        status: res.statusCode ?? 0,
        headers: res.headers,
        bytes: Buffer.concat(chunks),
        truncated,
      });
      res.on("data", (chunk: Buffer) => {
        if (truncated) return;
        const room = maxBytes - size;
        if (chunk.length > room) {
          chunks.push(chunk.subarray(0, room));
          size = maxBytes;
          truncated = true;
          finish(undefined, answer());
          res.destroy();
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      res.on("end", () => finish(undefined, answer()));
      // An answer cut halfway is still the service's answer: what arrived, marked cut.
      res.on("error", () => {
        truncated = true;
        finish(undefined, answer());
      });
      res.on("close", () => {
        if (!res.complete) truncated = true;
        finish(undefined, answer());
      });
    });
    req.on("error", () => finish(new FlowHttpError(sent ? "sent" : "unsent")));
  });
}
