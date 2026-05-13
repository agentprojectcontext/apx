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

const TOKEN_PATH = path.join(os.homedir(), ".apx", "daemon.token");

function readToken() {
  try { return fs.readFileSync(TOKEN_PATH, "utf8").trim(); } catch { return ""; }
}

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
  const token = readToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { "authorization": `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: opts.signal,
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

async function streamRequest(method, path, body, onEvent, opts = {}) {
  if (opts.autoStart !== false) await ensureDaemon();
  else if (!(await ping())) {
    throw new Error(`apx daemon not running (no response on ${baseUrl()})`);
  }

  const token = readToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { "authorization": `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    const err = new Error(json?.error || `${method} ${path} → ${res.status}`);
    err.status = res.status;
    throw err;
  }

  if (!res.body?.getReader) {
    throw new Error("streaming response is not supported by this Node.js runtime");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;

  // Register abort handler to cancel the reader
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => reader.cancel().catch(() => {}), { once: true });
  }

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      // AbortError or cancel — treat as clean end
      break;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "final") finalResult = event.result;
      if (event.type === "error") throw new Error(event.error || "stream error");
      await onEvent?.(event);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer);
      if (event.type === "final") finalResult = event.result;
      if (event.type === "error") throw new Error(event.error || "stream error");
      await onEvent?.(event);
    } catch {}
  }

  return finalResult;
}

export const http = {
  get: (p, opts) => request("GET", p, undefined, opts),
  post: (p, body, opts) => request("POST", p, body, opts),
  streamPost: (p, body, onEvent, opts) => streamRequest("POST", p, body, onEvent, opts),
  put: (p, body, opts) => request("PUT", p, body, opts),
  patch: (p, body, opts) => request("PATCH", p, body, opts),
  delete: (p, opts) => request("DELETE", p, undefined, opts),
  baseUrl,
  ping,
  /** Create a fresh AbortController for cancelling in-flight requests. */
  createAbortController: () => new AbortController(),
};
