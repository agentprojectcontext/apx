// Serve the local admin panel from the daemon.
//
// The web bundle is built into src/interfaces/web/dist. When that folder
// exists, this module mounts it at `/` so users can open
// http://127.0.0.1:7430 and get the UI. The root namespace belongs to the
// panel alone — every data route lives under /api (see ./prefix.js) — so the
// SPA fallback only has to step aside for that single prefix instead of a
// hand-maintained list that drifts away from the route registry.
//
// During development the user runs `vite dev` on :7431 with proxy → :7430,
// so this mount is a no-op (dist/ doesn't exist yet).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isApiPath } from "./prefix.js";

// Re-exported so the SPA/API seam keeps a single import site for callers that
// reason about "which side of the seam is this path on?" (tests, auth).
export { isApiPath };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// host/daemon/api/web.js → ../../..  = src/   then interfaces/web/dist
const WEB_DIST = path.resolve(__dirname, "..", "..", "..", "interfaces", "web", "dist");

// Client-side routes the SPA actually knows how to render. Must mirror the
// <Routes> registry in src/interfaces/web/src/App.tsx. Anything else still
// gets the SPA shell (so React Router shows the styled 404 page) but with an
// HTTP 404 status, so curl/crawlers/health-checks see the right code instead
// of a misleading 200.
const SPA_ROUTES = [
  /^\/$/,
  /^\/settings(\/.*)?$/,
  /^\/m\/(voice|desktop|deck|code|inbox)(\/.*)?$/,
  /^\/mobile(\/.*)?$/,
  /^\/p\/[^/]+(\/.*)?$/,
];

export function isKnownSpaRoute(p) {
  return SPA_ROUTES.some((re) => re.test(p));
}

// /api/admin/web-token: localhost-only endpoint that returns the daemon token
// so the same-origin admin panel can authenticate every subsequent call.
// Refuses if the request didn't come from loopback. Also refuses if the
// request was tunneled in via Cloudflare/ngrok/etc. — those connect from
// a local agent so the socket IP IS loopback, but tunnel-specific headers
// give them away. When tunneled, the SPA must instead receive the token
// via URL fragment (#token=…) that the operator shares out-of-band.
//
// Registered on the API router (not the static mount below) so the panel's
// bootstrap call is a normal /api/* request like every other.
export function registerWebToken(api, { token }) {
  api.get("/admin/web-token", (req, res) => {
    const ra = req.ip || req.socket?.remoteAddress || "";
    const isLocal =
      ra === "127.0.0.1" ||
      ra === "::1" ||
      ra === "::ffff:127.0.0.1" ||
      ra === "" /* in-process */;
    if (!isLocal) {
      return res.status(403).json({ error: "web-token is loopback-only" });
    }
    const tunneledHeaders = [
      "cf-connecting-ip",
      "cf-ray",
      "x-forwarded-for",
      "x-real-ip",
      "x-forwarded-host",
      "ngrok-trace-id",
    ];
    for (const h of tunneledHeaders) {
      if (req.headers[h]) {
        return res.status(403).json({
          error: "web-token disabled for tunneled requests — share #token=… in URL fragment instead",
        });
      }
    }
    res.json({ token });
  });
}

// Static admin panel at the root. Mounted after `app.use("/api", api)` in
// api.js, so a stray /api/* request can never reach the SPA fallback.
export function register(app, { express }) {
  if (!fs.existsSync(WEB_DIST)) {
    // No build present. Expose a hint endpoint so users hitting the daemon
    // root know what to do.
    app.get("/", (_req, res) => {
      res
        .status(200)
        .type("text/html")
        .send(
          [
            "<!doctype html><meta charset='utf-8'><title>APX</title>",
            "<style>body{font:14px/1.5 system-ui;padding:2rem;color:#aab2bc;background:#0b0d10}",
            "code{background:#1a1e23;padding:.1em .4em;border-radius:3px;font-family:ui-monospace,Menlo}</style>",
            "<h1 style='color:#d6dbe1'>APX daemon</h1>",
            "<p>The admin panel hasn't been built on this install.</p>",
            "<p>From the apx repo run:</p>",
            "<pre><code>cd src/interfaces/web && pnpm install && pnpm build</code></pre>",
            "<p>Or develop with hot reload:</p>",
            "<pre><code>cd src/interfaces/web && pnpm dev</code></pre>",
            "<p>Meanwhile the CLI works as usual — try <code>apx status</code>.</p>",
          ].join("")
        );
    });
    return;
  }

  // Serve static assets. NB: we mount AFTER the /api router is mounted in
  // api.js so data routes always win over this catch-all.
  app.use(
    express.static(WEB_DIST, {
      index: false,
      etag: true,
      maxAge: "1h",
      setHeaders(res, filePath) {
        // index.html is the SPA shell — never cache it, so a redeploy is
        // picked up on the next reload.
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  // SPA fallback: anything that isn't an API path AND doesn't have a file
  // extension goes to index.html. The web app handles routing.
  app.get("*", (req, res, next) => {
    if (req.method !== "GET") return next();
    if (isApiPath(req.path)) return next();
    if (path.extname(req.path)) return next(); // let static handle 404 of /foo.png
    // Always serve the shell so the SPA can render, but set 404 for routes the
    // app doesn't recognize so the HTTP status matches what the user sees.
    res.status(isKnownSpaRoute(req.path) ? 200 : 404);
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
}
