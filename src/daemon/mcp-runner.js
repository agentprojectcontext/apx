// MCP runner: spawn child MCP processes and proxy JSON-RPC tools/call.
// Speaks the stdio transport: newline-delimited JSON-RPC 2.0 messages.
import { spawn } from "node:child_process";
import { loadAll } from "./mcp-sources.js";

const DEFAULT_TIMEOUT_MS = 30_000;

class McpProcess {
  constructor({ name, command, args = [], env = {} }) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.proc = null;
    this.buffer = "";
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this._nextId = 1;
    this._initPromise = null;
    this._initialized = false;
    this._stderrBuf = "";
  }

  start() {
    if (this.proc) return;
    this.proc = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stdout.on("data", (chunk) => this._onStdout(chunk));
    this.proc.stderr.on("data", (chunk) => {
      this._stderrBuf += chunk;
      if (this._stderrBuf.length > 4096) {
        this._stderrBuf = this._stderrBuf.slice(-4096);
      }
    });

    this.proc.on("exit", (code) => {
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
    return this._send("tools/list", {});
  }

  async callTool(name, args) {
    await this._ensureInitialized();
    return this._send("tools/call", { name, arguments: args || {} });
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
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.processes = new Map(); // mcp name -> McpProcess
  }

  list() {
    return loadAll(this.projectPath).entries.map(entryToMeta);
  }

  conflicts() {
    return loadAll(this.projectPath).conflicts;
  }

  evict(name) {
    const proc = this.processes.get(name);
    if (proc) {
      proc.stop();
      this.processes.delete(name);
    }
  }

  getByName(name) {
    const e = loadAll(this.projectPath).entries.find((x) => x.name === name);
    return e ? entryToMeta(e) : null;
  }

  _ensureProcess(name) {
    let proc = this.processes.get(name);
    if (proc && proc.proc) return proc;
    const meta = this.getByName(name);
    if (!meta) throw new Error(`MCP "${name}" not registered`);
    if (!meta.enabled) throw new Error(`MCP "${name}" is disabled`);
    if (meta.transport === "http" || meta.url) {
      throw new Error(
        `MCP "${name}" uses HTTP transport (url=${meta.url}); HTTP/SSE transport arrives in v0.2. Use a stdio MCP for now.`
      );
    }
    if (!meta.command) throw new Error(`MCP "${name}" has no command — invalid registration`);
    proc = new McpProcess(meta);
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

  shutdown() {
    for (const p of this.processes.values()) p.stop();
    this.processes.clear();
  }
}
