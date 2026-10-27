// The public listener is independent of the private panel/RPC. Only explicitly resolved routes can run here.
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { HookRequest, HookResponse } from "../channels/types.ts";
import type { RunTimers } from "../engine/engine.ts";
import type { Log } from "../log.ts";

const wallTimers: RunTimers = {
  now: () => Date.now(),
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

export const PUBLIC_BODY_MAX = 1024 * 1024;
export const PUBLIC_DEADLINE_MS = 15_000;
export type PublicRoute = {
  /** A bounded, non-secret identifier used for rate limiting, never a URL or token. */
  id: string;
  methods: readonly string[];
  authorize(headers: Record<string, string>): boolean;
  handle(request: HookRequest, signal: AbortSignal): Promise<HookResponse>;
};
export type PublicRoutes = (path: string) => PublicRoute | undefined;

/** Reject ambiguous targets before URL parsing can erase dot segments or decode separators. */
export function publicPath(target: string): string | undefined {
  if (
    !target.startsWith("/") ||
    target.startsWith("//") ||
    /[%\\#]/.test(target) ||
    [...target].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
  )
    return;
  const pathname = target.split("?")[0];
  if (!pathname || pathname.includes("//") || pathname.split("/").some((p) => p === "." || p === "..")) return;
  return pathname;
}

export function publicRateLimit(now: () => number = Date.now, maximum = 120, windowMs = 60_000) {
  const buckets = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const at = now();
    for (const [id, b] of buckets) if (at - b.start >= windowMs) buckets.delete(id);
    const b = buckets.get(key) ?? { start: at, count: 0 };
    // Unknown requests share a bucket; registered routes are capped by the registry, not attacker input.
    if (!buckets.has(key) && buckets.size >= 2048) return false;
    buckets.set(key, b);
    return ++b.count <= maximum;
  };
}

function readBody(req: IncomingMessage, signal: AbortSignal): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    const clean = () => {
      req.off("data", data);
      req.off("end", end);
      req.off("error", error);
      signal.removeEventListener("abort", abort);
    };
    const finish = (body: Buffer | undefined) => {
      clean();
      resolve(body);
    };
    const data = (c: Buffer) => {
      size += c.length;
      if (size > PUBLIC_BODY_MAX) finish(undefined);
      else parts.push(c);
    };
    const end = () => finish(Buffer.concat(parts));
    const error = (err: Error) => {
      clean();
      reject(err);
    };
    const abort = () => finish(undefined);
    req.on("data", data).once("end", end).once("error", error);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function answer(res: ServerResponse, r: HookResponse): void {
  if (res.destroyed || res.writableEnded) return;
  const json = typeof r.body === "object";
  const body = r.body === undefined ? "" : json ? JSON.stringify(r.body) : String(r.body);
  res.writeHead(r.status, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(body ? { "content-type": json ? "application/json" : "text/plain; charset=utf-8" } : {}),
    ...r.headers,
  });
  res.end(body);
}

export type PublicListenerOptions = { port: number; routes: PublicRoutes; log: Log; timers?: RunTimers };

function handler(o: PublicListenerOptions) {
  const timers = o.timers ?? wallTimers;
  const limit = publicRateLimit(timers.now);
  const total = publicRateLimit(timers.now, 1200);
  let active = 0;
  return (req: IncomingMessage, res: ServerResponse) => {
    // Every response closes its connection: failed authentication never leaves an unread upload on keep-alive.
    res.setHeader("connection", "close");
    const pathname = publicPath(req.url ?? "");
    if (!total("all") || active >= 128) return answer(res, { status: 429, headers: { "retry-after": "60" } });
    const route = pathname ? o.routes(pathname) : undefined;
    if (!route) return answer(res, { status: 404 });
    if (!limit(route.id)) return answer(res, { status: 429, headers: { "retry-after": "60" } });
    if (!route.methods.includes(req.method ?? ""))
      return answer(res, { status: 405, headers: { allow: route.methods.join(", ") } });
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")]),
    );
    if (!route.authorize(headers)) return answer(res, { status: 401 });
    if (Number(req.headers["content-length"] ?? 0) > PUBLIC_BODY_MAX) return answer(res, { status: 413 });
    active++;
    const controller = new AbortController();
    const cancelDeadline = timers.after(PUBLIC_DEADLINE_MS, () => {
      answer(res, { status: 503 });
      controller.abort();
    });
    // Disconnects cancel downstream work as well as uploads. The deadline covers reading AND delivery.
    const abort = () => controller.abort();
    res.once("close", abort);
    const run = async () => {
      const body = await readBody(req, controller.signal);
      if (controller.signal.aborted) return;
      if (!body) return answer(res, { status: 413 });
      answer(
        res,
        await route.handle({ method: req.method ?? "", path: pathname ?? "", headers, body }, controller.signal),
      );
    };
    void run()
      .catch(() => {
        // Never include payloads, headers, URL queries or adapter exceptions in internet-facing logs.
        o.log.warn({ route: route.id }, "public request failed");
        answer(res, { status: 500 });
      })
      .finally(() => {
        active--;
        cancelDeadline();
        res.off("close", abort);
      });
  };
}

/** A taken preferred port falls back to a free loopback port; the tunnel uses the resulting port. */
export async function listenHooks(o: PublicListenerOptions): Promise<{ port: number; close(): Promise<void> }> {
  try {
    return await bind(o.port, o);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || o.port === 0) throw err;
    o.log.warn({ port: o.port }, "public listener: port taken, using a free one");
    return bind(0, o);
  }
}

function bind(port: number, o: PublicListenerOptions): Promise<{ port: number; close(): Promise<void> }> {
  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, handler(o));
  server.requestTimeout = PUBLIC_DEADLINE_MS;
  server.headersTimeout = PUBLIC_DEADLINE_MS;
  server.maxConnections = 256;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        port: typeof addr === "object" && addr ? addr.port : port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
