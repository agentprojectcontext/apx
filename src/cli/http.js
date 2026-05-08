// Tiny HTTP client to talk to the APX daemon. Auto-starts the daemon if down.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = parseInt(process.env.APX_PORT || "7430", 10);
const DEFAULT_HOST = process.env.APX_HOST || "127.0.0.1";

function baseUrl() {
  return `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
}

async function ping(timeoutMs = 400) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${baseUrl()}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function findDaemonEntry() {
  const candidates = [
    path.resolve(__dirname, "..", "daemon", "index.js"),
    path.resolve(__dirname, "..", "node_modules", "apx-daemon", "src", "index.js"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

async function autoStart({ silent = false } = {}) {
  const entry = findDaemonEntry();
  if (!entry) {
    throw new Error(
      "apx daemon not installed and not found at ../daemon/src/index.js. Install with `npm i -g apx-daemon` or run from the apc monorepo."
    );
  }
  const logPath = path.join(os.homedir(), ".apx", "daemon.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const out = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env },
  });
  child.unref();
  if (!silent) process.stderr.write("apx: starting daemon...\n");
  // Wait up to 4s for /health
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await ping(200)) return true;
  }
  throw new Error("apx daemon failed to start within 4s — check ~/.apx/daemon.log");
}

export async function ensureDaemon(opts = {}) {
  if (await ping()) return;
  await autoStart(opts);
}

async function request(method, path, body, opts = {}) {
  if (opts.autoStart !== false) await ensureDaemon();
  else if (!(await ping())) {
    throw new Error(`apx daemon not running (no response on ${baseUrl()})`);
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    return text;
  }
  if (!res.ok) {
    const msg = json?.error || `${method} ${path} → ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export const http = {
  get: (p, opts) => request("GET", p, undefined, opts),
  post: (p, body, opts) => request("POST", p, body, opts),
  put: (p, body, opts) => request("PUT", p, body, opts),
  patch: (p, body, opts) => request("PATCH", p, body, opts),
  delete: (p, opts) => request("DELETE", p, undefined, opts),
  baseUrl,
  ping,
};
