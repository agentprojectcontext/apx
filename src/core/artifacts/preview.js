// Ephemeral artifact preview servers.
//
// Given a managed artifact (see #core/stores/artifacts.js), spin up a tiny
// local HTTP server that renders it in a browser:
//   - .html/.htm            → served as-is, with a live-reload snippet injected
//   - .jsx/.tsx/.js (React) → wrapped in an HTML shell (React UMD + Babel +
//                             Tailwind Play CDN) so single-file components render
//   - a directory / index   → served statically as a mini web root
//   - anything else          → served as text
//
// Each server listens on an ephemeral 127.0.0.1 port and watches its source
// files; on change it pushes a "reload" event over Server-Sent Events so the
// open browser tab refreshes itself. Servers are tracked in a process-wide
// registry so the CLI/web/API can list, share (tunnel), and stop them.
//
// This module is intentionally dependency-free (node http/fs only) so it can
// run inside the daemon without pulling in a bundler.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { artifactPath } from "#core/stores/artifacts.js";

// Extensions we treat as single-file React components to wrap in a shell.
const REACT_EXT = new Set([".jsx", ".tsx"]);
// Plain HTML documents served verbatim (plus reload injection).
const HTML_EXT = new Set([".html", ".htm"]);

// Minimal content-type table for the static file server. Anything not listed
// falls back to application/octet-stream (browser will download/guess).
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

// Path the browser polls for live-reload events (SSE). Namespaced so it can't
// collide with a real asset the artifact ships.
const RELOAD_PATH = "/__apx/reload";

// Snippet injected into every served HTML page. Opens an SSE channel and
// reloads the tab whenever the server signals a source change. Silently no-ops
// if EventSource is unavailable.
const RELOAD_SNIPPET = `
<script>(function(){try{
  var es=new EventSource(${JSON.stringify(RELOAD_PATH)});
  es.onmessage=function(e){if(e.data==="reload"){es.close();location.reload();}};
}catch(_){}})();</script>`;

// Debounce window for fs.watch — editors fire several events per save.
const WATCH_DEBOUNCE_MS = 120;

// Classify what kind of preview an artifact needs.
function classify(absPath) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return { kind: "missing" };
  }
  if (stat.isDirectory()) return { kind: "static", root: absPath, entry: "index.html" };
  const ext = path.extname(absPath).toLowerCase();
  if (HTML_EXT.has(ext)) return { kind: "html", root: path.dirname(absPath), entry: path.basename(absPath) };
  if (REACT_EXT.has(ext)) return { kind: "react", root: path.dirname(absPath), entry: path.basename(absPath) };
  // .js is ambiguous: treat as React only when it clearly looks like JSX/React.
  if (ext === ".js") {
    let head = "";
    try { head = fs.readFileSync(absPath, "utf8").slice(0, 4000); } catch { /* ignore */ }
    if (/\breact\b|useState|useEffect|ReactDOM|export\s+default|<[A-Za-z]/.test(head)) {
      return { kind: "react", root: path.dirname(absPath), entry: path.basename(absPath) };
    }
  }
  return { kind: "text", root: path.dirname(absPath), entry: path.basename(absPath) };
}

// Insert the live-reload snippet before </body> (or append if there's none).
function injectReload(html) {
  if (html.includes("</body>")) return html.replace("</body>", `${RELOAD_SNIPPET}\n</body>`);
  return html + RELOAD_SNIPPET;
}

// Turn a single-file React/JSX component into a full HTML document. We can't
// run a bundler in-process, so we lean on the same CDN approach Claude's
// artifacts use: React UMD + Babel standalone (JSX/TS in the browser) +
// Tailwind Play CDN for styling. `import` lines are stripped (React globals are
// destructured for you) and `export default X` is rewired to a mount call.
function reactShell(source, title) {
  const preamble =
    "const { useState, useEffect, useRef, useMemo, useCallback, useReducer, " +
    "useContext, createContext, useLayoutEffect, Fragment } = React;\n";
  // Drop bare `import ... from '...'` lines — dependencies aren't resolvable in
  // this lightweight shell; React hooks are provided by the preamble above.
  let code = source.replace(/^[ \t]*import\s.*(?:\n|$)/gm, "");
  // `export default <expr>` → capture the component so we can render it.
  code = code.replace(/export\s+default\s+/g, "window.__APX_ARTIFACT__ = ");
  // Strip remaining named `export ` keywords (declarations stay valid without).
  code = code.replace(/^[ \t]*export\s+(?=(const|function|let|var|class)\b)/gm, "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{margin:0}#apx-error{font:13px/1.5 ui-monospace,monospace;color:#b91c1c;white-space:pre-wrap;padding:16px}</style>
</head>
<body>
<div id="root"></div>
<div id="apx-error"></div>
<script type="text/babel" data-presets="react,typescript" data-type="module">
${preamble}${code}
try {
  var C = window.__APX_ARTIFACT__;
  if (!C) { C = (typeof App !== "undefined") ? App : null; }
  if (!C) throw new Error("No default export or App component found to render.");
  var el = React.isValidElement(C) ? C : React.createElement(C);
  ReactDOM.createRoot(document.getElementById("root")).render(el);
} catch (err) {
  document.getElementById("apx-error").textContent = "APX preview error: " + (err && err.message || err);
}
</script>
${RELOAD_SNIPPET}
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Resolve a request path to a real file inside `root`, guarding against
// traversal. Returns null when the target escapes root or doesn't exist.
function resolveStatic(root, urlPath) {
  const rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const abs = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) return null;
  try {
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      const idx = path.join(abs, "index.html");
      return fs.existsSync(idx) ? idx : null;
    }
    return abs;
  } catch {
    return null;
  }
}

export class PreviewManager {
  constructor() {
    /** @type {Map<string, object>} id → record */
    this.servers = new Map();
  }

  // Public, serializable view of a preview record (no live handles).
  static view(rec) {
    return {
      id: rec.id,
      projectId: rec.projectId,
      name: rec.name,
      kind: rec.kind,
      port: rec.port,
      url: rec.url,
      watch: rec.watch,
      createdAt: rec.createdAt,
      hits: rec.hits,
      tunnel: rec.tunnel
        ? { id: rec.tunnel.id, url: rec.tunnel.url, provider: rec.tunnel.provider }
        : null,
    };
  }

  list(projectId) {
    const all = [...this.servers.values()].map((r) => PreviewManager.view(r));
    return projectId == null ? all : all.filter((r) => String(r.projectId) === String(projectId));
  }

  get(id) {
    return this.servers.get(id) || null;
  }

  // Start (or reuse) a preview server for the given artifact.
  //   { storagePath, name, projectId, watch, host }
  // Reuses an existing server for the same (projectId, name) so repeated
  // previews don't leak ports.
  async start({ storagePath, name, projectId = null, watch = true, host = "127.0.0.1" }) {
    if (!name) throw new Error("preview: missing artifact name");
    const absPath = artifactPath(storagePath, name);
    const c = classify(absPath);
    if (c.kind === "missing") throw new Error(`artifact "${name}" not found`);

    // Reuse a live server for the same artifact in the same project.
    for (const rec of this.servers.values()) {
      if (String(rec.projectId) === String(projectId) && rec.name === name) {
        return PreviewManager.view(rec);
      }
    }

    const id = randomUUID().slice(0, 8);
    const record = {
      id,
      projectId,
      name,
      kind: c.kind,
      root: c.root,
      entry: c.entry,
      entryAbs: absPath,
      watch: !!watch,
      createdAt: new Date().toISOString(),
      hits: 0,
      clients: new Set(),
      watcher: null,
      server: null,
      port: null,
      url: null,
      tunnel: null,
    };

    const server = http.createServer((req, res) => this._handle(record, req, res));
    record.server = server;

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    const addr = server.address();
    record.port = addr.port;
    // localhost (not 127.0.0.1) so the printed link is friendlier & tunnelable.
    record.url = `http://localhost:${addr.port}/`;

    if (record.watch) this._watch(record);
    this.servers.set(id, record);
    return PreviewManager.view(record);
  }

  _handle(record, req, res) {
    const url = req.url || "/";
    const pathname = url.split("?")[0];

    // Live-reload SSE channel.
    if (pathname === RELOAD_PATH) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      record.clients.add(res);
      const ping = setInterval(() => {
        try { res.write(": ping\n\n"); } catch { /* ignore */ }
      }, 25_000);
      req.on("close", () => {
        clearInterval(ping);
        record.clients.delete(res);
      });
      return;
    }

    record.hits++;

    // Root request → render the entry according to its kind.
    if (pathname === "/" || pathname === "" || pathname === "/" + record.entry) {
      return this._renderEntry(record, res);
    }

    // Everything else → static file served from the artifact's directory.
    const file = resolveStatic(record.root, pathname);
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    return this._sendFile(record, res, file);
  }

  _renderEntry(record, res) {
    let source;
    try {
      source = fs.readFileSync(record.entryAbs, "utf8");
    } catch (e) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(`artifact "${record.name}" is gone: ${e.message}`);
    }
    let html;
    if (record.kind === "react") {
      html = reactShell(source, record.name);
    } else if (record.kind === "html") {
      html = injectReload(source);
    } else if (record.kind === "static") {
      // Directory root: serve its index.html if present, else a listing.
      const idx = path.join(record.root, "index.html");
      if (fs.existsSync(idx)) return this._sendFile(record, res, idx);
      html = injectReload(`<!doctype html><meta charset=utf-8><title>${escapeHtml(record.name)}</title>` +
        `<pre>${escapeHtml(fs.readdirSync(record.root).join("\n"))}</pre>`);
    } else {
      // Plain text: show it in a <pre> with reload wired up.
      html = injectReload(`<!doctype html><meta charset=utf-8><title>${escapeHtml(record.name)}</title>` +
        `<pre style="font:13px/1.5 ui-monospace,monospace;padding:16px;white-space:pre-wrap">${escapeHtml(source)}</pre>`);
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  }

  _sendFile(record, res, file) {
    const ext = path.extname(file).toLowerCase();
    // HTML assets get reload injection too so linked pages stay live.
    if (HTML_EXT.has(ext)) {
      let src = "";
      try { src = fs.readFileSync(file, "utf8"); } catch { /* ignore */ }
      res.writeHead(200, { "Content-Type": MIME[ext], "Cache-Control": "no-store" });
      return res.end(injectReload(src));
    }
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    fs.createReadStream(file).on("error", () => {
      try { res.end(); } catch { /* ignore */ }
    }).pipe(res);
  }

  // Watch the artifact's directory and notify SSE clients on change.
  _watch(record) {
    let timer = null;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const client of record.clients) {
          try { client.write("data: reload\n\n"); } catch { /* ignore */ }
        }
      }, WATCH_DEBOUNCE_MS);
    };
    try {
      record.watcher = fs.watch(record.root, { persistent: false }, fire);
    } catch {
      // Watching unsupported here — preview still works, just no auto-reload.
      record.watch = false;
    }
  }

  // Stop a preview server (and its tunnel, if any). Returns true if it existed.
  async stop(id) {
    const rec = this.servers.get(id);
    if (!rec) return false;
    try { rec.watcher?.close(); } catch { /* ignore */ }
    for (const client of rec.clients) { try { client.end(); } catch { /* ignore */ } }
    rec.clients.clear();
    await new Promise((resolve) => {
      try { rec.server.close(() => resolve()); } catch { resolve(); }
      // Don't hang shutdown on lingering keep-alive sockets.
      setTimeout(resolve, 500);
    });
    this.servers.delete(id);
    return true;
  }

  async stopAll() {
    await Promise.all([...this.servers.keys()].map((id) => this.stop(id)));
  }

  // Attach an opened tunnel to a preview record so listings can surface it.
  attachTunnel(id, tunnel) {
    const rec = this.servers.get(id);
    if (rec) rec.tunnel = tunnel;
  }
}

// Process-wide singleton — the daemon holds exactly one preview registry.
export const previews = new PreviewManager();
