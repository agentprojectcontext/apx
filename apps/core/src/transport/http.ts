import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Log } from "../log.ts";
import type { Dispatch } from "../rpc/router.ts";

const MAX_BODY = 1024 * 1024;

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
  let file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(root)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  if (!fs.existsSync(file)) return false;
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

export type PublicPages = { artifact(token: string): { title: string; html: string } | undefined };

// Artifacts run with an opaque origin (CSP sandbox without allow-same-origin): no cookies, no API access.
const ARTIFACT_CSP =
  "sandbox allow-scripts allow-popups; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'; frame-ancestors *";

function artifactPage(title: string, html: string): string {
  const esc = title.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const doc = /<html[\s>]/i.test(html)
    ? html
    : `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc}</title><style>:root{--apx-bg:#faf9f7;--apx-surface:#fff;--apx-fg:#1c1b19;--apx-fg-muted:#6f6b63;--apx-border:#e6e3dc;--apx-brand:#1f9d63}@media (prefers-color-scheme:dark){:root{--apx-bg:#1b1a18;--apx-surface:#252421;--apx-fg:#ecebe7;--apx-fg-muted:#9b978d;--apx-border:#34322e;--apx-brand:#3fbf84}}body{margin:0;padding:16px;background:var(--apx-bg);color:var(--apx-fg);font:14px/1.45 system-ui,sans-serif}</style></head><body>${html}</body></html>`;
  return doc;
}

export function httpHandler(
  dispatch: Dispatch,
  log: Log,
  token: string | undefined,
  webDist?: string,
  pages?: PublicPages,
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://core");
    if (req.method === "GET" && url.pathname === "/health") {
      return send(
        res,
        200,
        await dispatch("system.health", {}, { transport: "http", role: "operator", session: undefined, log }),
      );
    }
    if (req.method === "POST" && url.pathname.startsWith("/rpc/")) {
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        return send(res, 401, { ok: false, error: { code: "unauthorized", message: "missing or bad token" } });
      }
      let body: unknown;
      try {
        body = await readJson(req);
      } catch (err) {
        return send(res, 400, { ok: false, error: { code: "bad_request", message: String(err) } });
      }
      const idem = header(req, "idempotency-key");
      const out = await dispatch(
        url.pathname.slice(5),
        body,
        { transport: "http", role: "operator", session: undefined, log },
        idem,
      );
      return send(res, out.ok ? 200 : statusFor(out.error.code), out);
    }
    const share = /^\/a\/([a-f0-9]{32})$/.exec(url.pathname);
    if (req.method === "GET" && share && pages) {
      const page = pages.artifact(share[1] ?? "");
      if (!page) return send(res, 404, { ok: false, error: { code: "bad_request", message: "not found" } });
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": ARTIFACT_CSP,
        "cache-control": "no-store",
      });
      res.end(artifactPage(page.title, page.html));
      return;
    }
    if (req.method === "GET" && webDist && serveStatic(webDist, url.pathname, res)) return;
    send(res, 404, { ok: false, error: { code: "bad_request", message: "not found" } });
  };
}

function statusFor(code: string): number {
  return code === "unknown_method" ? 404 : code === "bad_request" ? 400 : code === "unauthorized" ? 401 : 500;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
