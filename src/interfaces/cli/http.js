// Tiny HTTP client to talk to the APX daemon. Auto-starts the daemon if down.
//
// Callers pass the full daemon path including the /api mount point
// (`http.get("/api/projects")`), so a route grepped in a command matches the
// route registered in src/host/daemon/api/ verbatim. baseUrl() is the origin
// only — it deliberately does NOT bake in the prefix.
import fs from "node:fs";
import nodeHttp from "node:http";
import os from "node:os";
import path from "node:path";
import { TOKEN_PATH, LOG_PATH } from "#core/config/paths.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = parseInt(process.env.APX_PORT || "7430", 10);
const DEFAULT_HOST = process.env.APX_HOST || "127.0.0.1";



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
    const res = await fetch(`${baseUrl()}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function findDaemonEntry() {
  const entry = path.resolve(__dirname, "../../host/daemon/index.js");
  return fs.existsSync(entry) ? entry : null;
}

async function autoStart({ silent = false } = {}) {
  const entry = findDaemonEntry();
  if (!entry) {
    throw new Error(
      "apx daemon not installed and not found at src/host/daemon/index.js. Install with `npm i -g @agentprojectcontext/apx`."
    );
  }
  const logPath = LOG_PATH;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const out = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env },
  });
  child.unref();
  if (!silent) process.stderr.write("apx: starting daemon...\n");
  // Wait for /health. Four seconds was not enough and turned a slow boot into
  // "apx daemon failed to start" on a daemon that then came up fine seconds
  // later — this one loads sixteen projects, opens the sqlite-vec store and
  // preloads a whisper model before it answers. Twenty is generous and costs
  // nothing when the daemon is quick: the loop returns the moment /health does.
  const DEADLINE_MS = 20_000;
  const started = Date.now();
  while (Date.now() - started < DEADLINE_MS) {
    await new Promise((r) => setTimeout(r, 200));
    if (await ping(200)) return true;
  }
  throw new Error(`apx daemon failed to start within ${Math.round(DEADLINE_MS / 1000)}s — check ~/.apx/daemon.log`);
}

// The default port belongs to the default home.
//
// A daemon serves ONE ~/.apx, and the port it answers on is shared by everything
// on the machine — so a process whose APX_HOME points somewhere else must not be
// the one that claims it. A test suite does exactly that: it sets APX_HOME to a
// sandbox, runs an `apx` command, finds nothing on 7430 (because the real daemon
// happened to be restarting) and auto-starts a daemon that then answers for an
// empty temp home. Every token 401s, no channel is connected, and the only
// symptom is that WhatsApp quietly stops replying — with `/api/health` still
// saying "ok", because health does not know which home it is serving.
//
// Seen for real on 2026-09-08: a preflight run during a daemon restart left the
// user's WhatsApp offline for four minutes with nothing in any log saying why.
//
// So: auto-start only for the home the port is for. Anyone deliberately running
// another home is told to start it themselves — they have to anyway, since the
// two cannot share a port.
const SHARED_PORT = 7430;

function ownsDefaultPort() {
  // A port of its own is a port it owns — but naming the SHARED one explicitly
  // is not ownership, it is the collision. (This read `if (process.env.APX_PORT)
  // return true`, which let a suite that sets APX_PORT=7430 straight through.)
  if (DEFAULT_PORT !== SHARED_PORT) return true;
  const home = process.env.APX_HOME;
  if (!home) return true;
  // `os.userInfo()` and NOT `process.env.HOME`. A test sandbox moves HOME as
  // well as APX_HOME, so "APX_HOME is $HOME/.apx" is true inside it — the check
  // passed for exactly the case it existed to catch. userInfo reads the password
  // database, which no environment variable can move.
  return path.resolve(home) === path.resolve(path.join(os.userInfo().homedir, ".apx"));
}

export async function ensureDaemon(opts = {}) {
  if (await ping()) return;
  if (!ownsDefaultPort()) {
    throw new Error(
      `apx: no daemon on port ${DEFAULT_PORT}, and APX_HOME is ${process.env.APX_HOME} — ` +
      "refusing to auto-start, because that daemon would answer for the wrong home on the shared port. " +
      "Start it yourself, or set APX_PORT to a port of its own."
    );
  }
  await autoStart(opts);
}

// A dropped socket and a refusal from the daemon are different facts, and the
// caller has to be able to tell them apart: one means "we do not know whether
// this happened", the other means "the daemon said no". Tagged here so no
// command has to string-match "fetch failed".
function transport(e) {
  e.transport = true;
  return e;
}

// A request that is allowed to take longer than `fetch` will wait.
//
// undici — Node's fetch — gives up on a request after 300 s (headersTimeout),
// and that is EXACTLY the daemon's own default budget for a delivered a2a
// turn. Two deadlines set to the same number means a peer that uses its whole
// budget loses the race by a hair: `apx send --deliver` died with
// `TypeError: fetch failed` over a message that HAD been delivered and a reply
// that was still on its way, four times out of five. node:http has no such
// default, so a caller that says how long it is willing to wait gets to wait
// that long.
function requestLong(method, p, body, { timeoutMs, token, signal }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = nodeHttp.request(
      {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        path: p,
        method,
        headers: {
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { text += c; });
        res.on("end", () => {
          let json;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            if (res.statusCode >= 400) return reject(new Error(`${method} ${p} → ${res.statusCode}: ${text}`));
            return resolve(text);
          }
          if (res.statusCode >= 400) {
            const err = new Error(json?.error || `${method} ${p} → ${res.statusCode}`);
            err.status = res.statusCode;
            return reject(err);
          }
          resolve(json);
        });
        res.on("error", (e) => reject(transport(e)));
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(transport(new Error(`no reply from the daemon after ${Math.round(timeoutMs / 1000)}s`)));
    });
    req.on("error", (e) => reject(e.transport ? e : transport(e)));
    if (signal) signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    if (payload) req.write(payload);
    req.end();
  });
}

async function request(method, path, body, opts = {}) {
  if (opts.autoStart !== false) await ensureDaemon();
  else if (!(await ping())) {
    throw new Error(`apx daemon not running (no response on ${baseUrl()})`);
  }
  const token = readToken();
  // `timeoutMs` opts out of fetch's fixed 300 s ceiling — see requestLong().
  if (opts.timeoutMs) return requestLong(method, path, body, { timeoutMs: opts.timeoutMs, token, signal: opts.signal });
  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { "authorization": `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    throw transport(e);
  }
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

// Like request(), but sends a raw body (Buffer/Uint8Array/string) with
// caller-supplied headers instead of JSON. For endpoints that take bytes, not
// objects — e.g. POST /api/transcribe/chunk wants the audio itself in the body
// plus X-Audio-Format / X-Language / X-Provider headers.
async function rawRequest(method, path, body, opts = {}) {
  if (opts.autoStart !== false) await ensureDaemon();
  else if (!(await ping())) {
    throw new Error(`apx daemon not running (no response on ${baseUrl()})`);
  }
  const token = readToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      ...(opts.headers || {}),
      ...(token ? { "authorization": `Bearer ${token}` } : {}),
    },
    body,
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

  // A read that dies mid-stream is NOT a clean end unless the caller aborted:
  // the turn was cut off. Remembered here and raised below, because breaking
  // out silently returned null and the caller printed an empty answer with exit
  // 0 — the turn had failed and nothing said so.
  let readError = null;

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (!opts.signal?.aborted) readError = e;
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

  // Trailing line with no newline. Only a PARSE failure is ignorable here — a
  // half-written line at a dropped connection. Wrapping the whole block in a
  // bare catch also swallowed the `error` event's throw, which is how a failed
  // turn reached the user as a blank line and a zero exit code.
  buffer += decoder.decode();
  if (buffer.trim()) {
    let event = null;
    try {
      event = JSON.parse(buffer);
    } catch {
      event = null;
    }
    if (event) {
      if (event.type === "final") finalResult = event.result;
      if (event.type === "error") throw new Error(event.error || "stream error");
      await onEvent?.(event);
    }
  }

  if (readError) {
    throw new Error(
      `${method} ${path}: the stream ended early (${readError.message}). The turn did not finish.`
    );
  }

  return finalResult;
}

export const http = {
  get: (p, opts) => request("GET", p, undefined, opts),
  post: (p, body, opts) => request("POST", p, body, opts),
  postRaw: (p, body, opts) => rawRequest("POST", p, body, opts),
  streamPost: (p, body, onEvent, opts) => streamRequest("POST", p, body, onEvent, opts),
  put: (p, body, opts) => request("PUT", p, body, opts),
  patch: (p, body, opts) => request("PATCH", p, body, opts),
  delete: (p, opts) => request("DELETE", p, undefined, opts),
  baseUrl,
  ping,
  /** Create a fresh AbortController for cancelling in-flight requests. */
  createAbortController: () => new AbortController(),
};
