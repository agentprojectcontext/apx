// The webhook listener: a second HTTP server, on loopback, that takes only platforms' webhooks for channels
// (`…/hooks/<channel id>[/…]`). A public address (Tailscale Funnel, ngrok, the owner's own) publishes this port alone,
// never the panel or the API. See DECISIONS.md#d-139
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { HookRequest, HookResponse } from "../channels/types.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";

const MAX_BODY = 1024 * 1024;
/** Platforms give up and retry well before this; an adapter that takes longer has failed. */
const DEADLINE_MS = 15_000;
/** Whatever prefix the public address adds (a Funnel path, a proxy's), the channel and the rest of the path. */
const HOOK = /\/hooks\/([A-Za-z0-9_-]{1,64})(\/[^?#]*)?$/;

export type Deliver = (channelId: string, req: HookRequest) => Promise<HookResponse>;

function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(undefined);
        req.destroy();
      } else parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}

function answer(res: ServerResponse, r: HookResponse): void {
  const json = typeof r.body === "object";
  const body = r.body === undefined ? "" : json ? JSON.stringify(r.body) : String(r.body);
  res.writeHead(r.status, {
    ...(body ? { "content-type": json ? "application/json" : "text/plain; charset=utf-8" } : {}),
    ...r.headers,
  });
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse, deliver: Deliver, log: Log): Promise<void> {
  const url = new URL(req.url ?? "/", "http://hooks");
  const m = HOOK.exec(url.pathname);
  if (!m?.[1]) return answer(res, { status: 404 });
  if (req.method !== "POST") return answer(res, { status: 405, headers: { allow: "POST" } });
  const body = await readBody(req);
  if (!body) return answer(res, { status: 413 });
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")]),
  );
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<HookResponse>((resolve) => {
    timer = setTimeout(() => resolve({ status: 503 }), DEADLINE_MS);
  });
  try {
    answer(res, await Promise.race([deliver(m[1], { method: "POST", path: m[2] ?? "", headers, body }), late]));
  } catch (err) {
    // What failed stays in the log: the platform on the other side is told nothing about it.
    log.warn({ channel: m[1], err: errorMessage(err, 200) }, "channel webhook failed");
    answer(res, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Starts the listener on 127.0.0.1. A taken port (another core, a test daemon) falls back to a free one: the public
 * address is applied again with the port it got, so nothing outside depends on the number. Port 0 is a free one.
 */
export async function listenHooks(o: {
  port: number;
  deliver: Deliver;
  log: Log;
}): Promise<{ port: number; close(): Promise<void> }> {
  try {
    return await bind(o.port, o);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || o.port === 0) throw err;
    o.log.warn({ port: o.port }, "webhook listener: port taken, using a free one");
    return bind(0, o);
  }
}

function bind(port: number, o: { deliver: Deliver; log: Log }): Promise<{ port: number; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    void handle(req, res, o.deliver, o.log).catch(() => {
      if (!res.headersSent) answer(res, { status: 500 });
    });
  });
  server.requestTimeout = DEADLINE_MS + 5_000;
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
