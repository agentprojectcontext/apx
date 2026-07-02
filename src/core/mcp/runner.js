// MCP runner: spawn child MCP processes (stdio) or talk to remote MCP
// servers (HTTP). Speaks JSON-RPC 2.0 either way.
//
// Variables referenced as `${var.NAME}` in args/env/url/headers are resolved
// at process/client construction time against project + global vars. Missing
// references surface as a MissingVarError with the full list so the UI can
// report "missing TOKEN_A, TOKEN_B" instead of one-at-a-time.
import { spawn } from "node:child_process";
import { loadAll } from "./sources.js";
import { interpolate, MissingVarError } from "#core/vars/interpolate.js";
import { loadAllVars } from "#core/vars/sources.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const LOG_CAP = 64;            // entries per MCP we keep in memory
const STDERR_BUF_CAP = 4096;   // bytes of stderr tail we hand back

function nowIso() {
  return new Date().toISOString();
}

class McpProcess {
  constructor({ name, command, args = [], env = {} }) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.transport = "stdio";
    this.proc = null;
    this.buffer = "";
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this._nextId = 1;
    this._initPromise = null;
    this._initialized = false;
    this._stderrBuf = "";
    this.logs = []; // { ts, level, msg }
    this.startedAt = null;
    this.lastExitCode = null;
  }

  _log(level, msg) {
    this.logs.push({ ts: nowIso(), level, msg });
    if (this.logs.length > LOG_CAP) this.logs.shift();
  }

  start() {
    if (this.proc) return;
    this._log("info", `spawn ${this.command} ${(this.args || []).join(" ")}`);
    this.proc = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.startedAt = nowIso();

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stdout.on("data", (chunk) => this._onStdout(chunk));
    this.proc.stderr.on("data", (chunk) => {
      this._stderrBuf += chunk;
      if (this._stderrBuf.length > STDERR_BUF_CAP) {
        this._stderrBuf = this._stderrBuf.slice(-STDERR_BUF_CAP);
      }
      const trimmed = chunk.trim();
      if (trimmed) this._log("stderr", trimmed.slice(-512));
    });

    this.proc.on("exit", (code) => {
      this.lastExitCode = code;
      this._log("info", `exit code=${code}`);
      const err = new Error(
        `MCP "${this.name}" exited with code ${code}. stderr: ${this._stderrBuf.trim()}`
      );
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(err);
      }
      this.pending.clear();
      this.proc = null;
      this._initialized = false;
      this._initPromise = null;
    });
  }

  _onStdout(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "MCP error"));
        else resolve(msg.result);
      }
    }
  }

  _send(method, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.start();
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP "${this.name}" call ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      try {
        this.proc.stdin.write(payload + "\n");
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  async _ensureInitialized() {
    if (this._initialized) return;
    if (!this._initPromise) {
      this._initPromise = (async () => {
        await this._send(
          "initialize",
          {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "apx-daemon", version: "0.1.0" },
          },
          10_000
        );
        try {
          this.proc.stdin.write(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "notifications/initialized",
            }) + "\n"
          );
        } catch {}
        this._initialized = true;
      })();
    }
    return this._initPromise;
  }

  async listTools() {
    await this._ensureInitialized();
    return collectToolPages((cursor) =>
      this._send("tools/list", cursor ? { cursor } : {})
    );
  }

  async callTool(name, args) {
    await this._ensureInitialized();
    return this._send("tools/call", { name, arguments: args || {} });
  }

  getLogs() {
    return {
      transport: "stdio",
      command: this.command,
      args: this.args,
      started_at: this.startedAt,
      running: !!this.proc,
      last_exit_code: this.lastExitCode,
      stderr_tail: this._stderrBuf,
      events: this.logs.slice(),
    };
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
  }
}

// HTTP MCP client. Posts JSON-RPC 2.0 to the configured URL with the
// configured headers. Each call is a fresh fetch — we do not maintain a
// long-lived SSE stream. This works for servers that implement the simple
// JSON-RPC response style (which is most third-party MCP HTTP servers,
// including Asana's mcp.asana.com endpoint).
// Header values must be Latin1 — fetch throws "Cannot convert argument to a
// ByteString" on any code point above 255. We also normalize whitespace that
// the web editor's contentEditable injects: zero-width chars + non-breaking
// spaces (U+00A0 — the silent space substitute that makes Asana reject
// `Bearer\xA0token` with "Authorization header must be in format Bearer
// <token>"). One spot of sanitization covers every header value the runner
// sends, regardless of where the poisoned char originated.
function sanitizeHeaderValue(v) {
  return String(v)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ");
}

function sanitizeHeaders(h) {
  if (!h) return {};
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    out[sanitizeHeaderValue(k)] = sanitizeHeaderValue(v);
  }
  return out;
}

function redactHeaderValue(key, value) {
  const k = String(key || "").toLowerCase();
  if (
    k === "authorization" ||
    k === "proxy-authorization" ||
    k.includes("token") ||
    k.includes("secret") ||
    k.includes("key")
  ) {
    return "[redacted]";
  }
  const s = String(value ?? "");
  return s.length > 96 ? `${s.slice(0, 24)}...${s.slice(-12)}` : s;
}

function redactHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    out[k] = redactHeaderValue(k, v);
  }
  return out;
}

function summarizeRpcBody(method, params) {
  return JSON.stringify({
    jsonrpc: "2.0",
    method,
    params_keys: params && typeof params === "object" ? Object.keys(params) : [],
  });
}

class HttpMcpClient {
  constructor({ name, url, headers = {} }) {
    this.name = name;
    this.url = sanitizeHeaderValue(url);
    this.headers = sanitizeHeaders(headers);
    this.transport = "http";
    this._nextId = 1;
    this._initialized = false;
    this._initPromise = null;
    this.sessionId = null;
    this.logs = [];
    this.startedAt = null;
    this.lastError = null;
  }

  _log(level, msg) {
    this.logs.push({ ts: nowIso(), level, msg });
    if (this.logs.length > LOG_CAP) this.logs.shift();
  }

  _requestHeaders({ accept = "application/json, text/event-stream" } = {}) {
    return {
      "Content-Type": "application/json",
      Accept: accept,
      "MCP-Protocol-Version": "2024-11-05",
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      ...this.headers,
    };
  }

  async _rpc(method, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.startedAt) this.startedAt = nowIso();
    const id = this._nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = this._requestHeaders();
    this._log(
      "info",
      `POST ${method} headers=${JSON.stringify(redactHeaders(headers))} body=${summarizeRpcBody(method, params)}`
    );
    let res;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers,
        body,
        signal: ctrl.signal,
      });
    } catch (e) {
      this.lastError = e.message;
      this._log("error", `fetch failed: ${e.message}`);
      throw new Error(`MCP "${this.name}" HTTP error: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
    const contentType = res.headers.get("content-type") || "";
    const sessionId = res.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
      this._log("info", `session ${sessionId}`);
    }
    const text = await res.text();
    if (!res.ok) {
      this.lastError = `HTTP ${res.status}`;
      this._log("error", `HTTP ${res.status} ${text.slice(0, 200)}`);
      throw new Error(
        `MCP "${this.name}" HTTP ${res.status}: ${text.slice(0, 300)}`
      );
    }
    // text/event-stream — pluck the first JSON-RPC payload from the SSE frames.
    let payload;
    if (contentType.includes("text/event-stream")) {
      payload = parseFirstSseJson(text);
      if (!payload) {
        this.lastError = "no JSON in SSE stream";
        throw new Error(`MCP "${this.name}" returned empty SSE stream`);
      }
    } else {
      try {
        payload = JSON.parse(text);
      } catch (e) {
        this.lastError = `non-JSON response: ${e.message}`;
        throw new Error(
          `MCP "${this.name}" non-JSON response: ${text.slice(0, 300)}`
        );
      }
    }
    if (payload.error) {
      this.lastError = payload.error.message || "rpc error";
      throw new Error(payload.error.message || "MCP error");
    }
    return payload.result;
  }

  async _ensureInitialized() {
    if (this._initialized) return;
    if (!this._initPromise) {
      this._initPromise = (async () => {
        await this._rpc(
          "initialize",
          {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "apx-daemon", version: "0.1.0" },
          },
          10_000
        );
        // Best-effort notification — many servers ignore this for HTTP.
        try {
          const headers = this._requestHeaders({ accept: "application/json" });
          this._log(
            "info",
            `POST notifications/initialized headers=${JSON.stringify(redactHeaders(headers))} body=${summarizeRpcBody("notifications/initialized", {})}`
          );
          await fetch(this.url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "notifications/initialized",
            }),
          });
        } catch {}
        this._initialized = true;
      })();
    }
    return this._initPromise;
  }

  async listTools() {
    await this._ensureInitialized();
    return collectToolPages((cursor) =>
      this._rpc("tools/list", cursor ? { cursor } : {})
    );
  }

  async callTool(name, args) {
    await this._ensureInitialized();
    return this._rpc("tools/call", { name, arguments: args || {} });
  }

  getLogs() {
    return {
      transport: "http",
      url: this.url,
      started_at: this.startedAt,
      last_error: this.lastError,
      events: this.logs.slice(),
    };
  }

  stop() {
    this._initialized = false;
    this._initPromise = null;
    this.sessionId = null;
  }
}

// tools/list is paginated (nextCursor). Follow every page and hand back a
// single merged { tools } result so callers never see partial catalogs.
const MAX_TOOL_PAGES = 32;
async function collectToolPages(fetchPage) {
  const tools = [];
  let cursor;
  for (let i = 0; i < MAX_TOOL_PAGES; i++) {
    const result = await fetchPage(cursor);
    if (Array.isArray(result?.tools)) tools.push(...result.tools);
    cursor = result?.nextCursor;
    if (!cursor) break;
  }
  return { tools };
}

function parseFirstSseJson(raw) {
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) continue;
    try {
      return JSON.parse(dataLines.join("\n"));
    } catch {
      continue;
    }
  }
  return null;
}

function entryToMeta(e) {
  return {
    name: e.name,
    command: e.command,
    args: e.args,
    env: e.env,
    url: e.url,
    headers: e.headers || {},
    transport: e.transport || "stdio",
    source: e.source,
    enabled: e.enabled,
  };
}

export class McpRegistry {
  constructor(arg) {
    if (typeof arg === "string" || arg == null) {
      this.projectPath = arg || null;
      this.storagePath = null;
    } else {
      this.projectPath = arg.projectPath || null;
      this.storagePath = arg.storagePath || null;
    }
    this.processes = new Map(); // mcp name -> McpProcess | HttpMcpClient
  }

  _load() {
    return loadAll(this.projectPath, { storagePath: this.storagePath });
  }

  list() {
    return this._load().entries.map(entryToMeta);
  }

  conflicts() {
    return this._load().conflicts;
  }

  evict(name) {
    const proc = this.processes.get(name);
    if (proc) {
      proc.stop();
      this.processes.delete(name);
    }
  }

  getByName(name) {
    const e = this._load().entries.find((x) => x.name === name);
    return e ? entryToMeta(e) : null;
  }

  _resolveVars() {
    return loadAllVars({ storagePath: this.storagePath }).effective;
  }

  _resolveMeta(meta) {
    try {
      return interpolate(meta, this._resolveVars());
    } catch (e) {
      if (e instanceof MissingVarError) {
        const list = e.missing.map((n) => `\${var.${n}}`).join(", ");
        throw new Error(
          `MCP "${meta.name}" has undefined variable${e.missing.length > 1 ? "s" : ""}: ${list}. Define them at /p/<id>/vars (or globally at /p/0/vars).`
        );
      }
      throw e;
    }
  }

  _ensureProcess(name) {
    let proc = this.processes.get(name);
    if (proc) {
      if (proc.transport === "stdio" && proc.proc) return proc;
      if (proc.transport === "http") return proc;
    }
    const meta = this.getByName(name);
    if (!meta) throw new Error(`MCP "${name}" not registered`);
    if (!meta.enabled) throw new Error(`MCP "${name}" is disabled`);
    const resolved = this._resolveMeta(meta);
    if (resolved.transport === "http" || resolved.url) {
      proc = new HttpMcpClient(resolved);
    } else {
      if (!resolved.command) throw new Error(`MCP "${name}" has no command — invalid registration`);
      proc = new McpProcess(resolved);
    }
    this.processes.set(name, proc);
    return proc;
  }

  async call(name, tool, args) {
    const proc = this._ensureProcess(name);
    return proc.callTool(tool, args);
  }

  async listTools(name) {
    const proc = this._ensureProcess(name);
    return proc.listTools();
  }

  getLogs(name) {
    const proc = this.processes.get(name);
    if (proc) return proc.getLogs();
    const meta = this.getByName(name);
    if (!meta) return null;
    return {
      transport: meta.transport || "stdio",
      running: false,
      started_at: null,
      events: [],
      note: "MCP not started yet — open the Test or Call panel to spawn it.",
    };
  }

  shutdown() {
    for (const p of this.processes.values()) p.stop();
    this.processes.clear();
  }
}
