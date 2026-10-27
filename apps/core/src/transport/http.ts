import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { type ClientScope, FILE_PAYLOAD_BYTES, methodOpen } from "@apx/protocol";
import { type PublicPages, surfacePage } from "../surface-pages.ts";

export type { PublicPages } from "../surface-pages.ts";

import type { Log } from "../log.ts";
import { isInside } from "../paths.ts";
import type { Dispatch } from "../rpc/router.ts";
import { type Gate, localRequest, refuse } from "./guard.ts";

const MAX_BODY = 1024 * 1024;
/** Methods that carry a file (base64): their own params cap the size, this only bounds the read. */
const FILE_METHODS: ReadonlySet<string> = new Set([
  "media.upload",
  "media.transcribe",
  "media.listen",
  "skills.preview",
  "skills.import",
  // An artifact's store holds up to 5 MB; a bundle carries its database.
  "surfaces.store_set",
  "surfaces.import",
]);
const MAX_FILE_BODY = FILE_PAYLOAD_BYTES;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/** Serves the built web panel (SPA fallback to index.html). Paths cannot escape the dist folder. */
function serveStatic(dist: string, pathname: string, res: ServerResponse): boolean {
  const root = path.resolve(dist);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  let file = path.resolve(root, `.${decoded}`);
  if (!isInside(root, file)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  if (!fs.existsSync(file)) return false;
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

/** Which paired device a key belongs to (undefined: not a device's, or revoked). */
export type DeviceLookup = (token: string) => { id: string; name: string } | undefined;

/** Who an outside app's client token belongs to (undefined: unknown or revoked). */
export type ClientLookup = (token: string) => { id: string; name: string; scopes: ClientScope[] } | undefined;

export function httpHandler(
  dispatch: Dispatch,
  log: Log,
  gate: Gate,
  webDist?: string,
  pages?: PublicPages,
  clientOf?: ClientLookup,
  deviceOf?: DeviceLookup,
) {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://core");
    if (req.method === "GET" && url.pathname === "/health") {
      return send(
        res,
        200,
        await dispatch(
          "system.health",
          {},
          { transport: "http", role: "operator", actor: "human", session: undefined, log },
        ),
      );
    }
    if (req.method === "POST" && url.pathname.startsWith("/rpc/")) {
      const clientToken = header(req, "x-apx-client");
      const client = clientToken ? clientOf?.(clientToken) : undefined;
      const why = refuse(req, gate, null, Boolean(client), methodOpen(url.pathname.slice(5)));
      if (why) return send(res, 403, { ok: false, error: { code: "unauthorized", message: why } });
      // A JSON content type forces a CORS preflight, so a foreign page cannot post a "simple" request here.
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
        return send(res, 415, {
          ok: false,
          error: { code: "bad_request", message: "content-type must be application/json" },
        });
      }
      let body: unknown;
      try {
        body = await readJson(req, FILE_METHODS.has(url.pathname.slice(5)) ? MAX_FILE_BODY : MAX_BODY);
      } catch (err) {
        return send(res, 400, { ok: false, error: { code: "bad_request", message: String(err) } });
      }
      const idem = header(req, "idempotency-key");
      const auth = header(req, "authorization");
      const device = auth?.startsWith("Bearer apxd_") ? deviceOf?.(auth.slice(7)) : undefined;
      if (clientToken && !client)
        return send(res, 401, {
          ok: false,
          error: { code: "unauthorized", message: "unknown or revoked client token" },
        });
      const out = await dispatch(
        url.pathname.slice(5),
        body,
        {
          transport: "http",
          local: localRequest(req),
          role: "operator",
          // An outside app is a model, whatever it says it is.
          actor: client || header(req, "x-apx-actor") === "agent" ? "agent" : "human",
          ...(client ? { client } : {}),
          ...(device ? { device } : {}),
          session: undefined,
          log,
        },
        idem,
      );
      return send(res, out.ok ? 200 : statusFor(out.error.code), out);
    }
    if (req.method === "GET" && pages) {
      const page = surfacePage(url.pathname, pages);
      if (page) {
        res.writeHead(page.status, page.headers);
        res.end(typeof page.body === "string" ? page.body : "");
        return;
      }
    }
    if (req.method === "GET" && webDist && serveStatic(webDist, url.pathname, res)) return;
    send(res, 404, { ok: false, error: { code: "not_found", message: "not found" } });
  };
  return (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res).catch((err: unknown) => {
      log.error({ err: String(err), path: req.url }, "http handler failed");
      if (!res.headersSent) send(res, 500, { ok: false, error: { code: "internal", message: "internal error" } });
      else res.destroy();
    });
  };
}

function statusFor(code: string): number {
  return STATUS[code] ?? 500;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** The HTTP status each error code answers with. */
const STATUS: Record<string, number> = {
  unknown_method: 404,
  not_found: 404,
  bad_request: 400,
  unauthorized: 401,
  conflict: 409,
  unavailable: 503,
  timeout: 504,
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
