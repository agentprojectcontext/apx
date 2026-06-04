#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/cli/http.js
var http_exports = {};
__export(http_exports, {
  ensureDaemon: () => ensureDaemon,
  http: () => http
});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
function readToken() {
  try {
    return fs.readFileSync(TOKEN_PATH, "utf8").trim();
  } catch {
    return "";
  }
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
    path.resolve(__dirname, "..", "node_modules", "apx-daemon", "src", "index.js")
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
    env: { ...process.env }
  });
  child.unref();
  if (!silent) process.stderr.write("apx: starting daemon...\n");
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await ping(200)) return true;
  }
  throw new Error("apx daemon failed to start within 4s \u2014 check ~/.apx/daemon.log");
}
async function ensureDaemon(opts = {}) {
  if (await ping()) return;
  await autoStart(opts);
}
async function request(method, path2, body, opts = {}) {
  if (opts.autoStart !== false) await ensureDaemon();
  else if (!await ping()) {
    throw new Error(`apx daemon not running (no response on ${baseUrl()})`);
  }
  const token = readToken();
  const res = await fetch(`${baseUrl()}${path2}`, {
    method,
    headers: {
      ...body ? { "content-type": "application/json" } : {},
      ...token ? { "authorization": `Bearer ${token}` } : {}
    },
    body: body ? JSON.stringify(body) : void 0,
    signal: opts.signal
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new Error(`${method} ${path2} \u2192 ${res.status}: ${text}`);
    return text;
  }
  if (!res.ok) {
    const msg = json?.error || `${method} ${path2} \u2192 ${res.status}`;
    throw new Error(msg);
  }
  return json;
}
async function streamRequest(method, path2, body, onEvent, opts = {}) {
  if (opts.autoStart !== false) await ensureDaemon();
  else if (!await ping()) {
    throw new Error(`apx daemon not running (no response on ${baseUrl()})`);
  }
  const token = readToken();
  const res = await fetch(`${baseUrl()}${path2}`, {
    method,
    headers: {
      ...body ? { "content-type": "application/json" } : {},
      ...token ? { "authorization": `Bearer ${token}` } : {}
    },
    body: body ? JSON.stringify(body) : void 0,
    signal: opts.signal
  });
  if (!res.ok) {
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
    }
    const err = new Error(json?.error || `${method} ${path2} \u2192 ${res.status}`);
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
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => reader.cancel().catch(() => {
    }), { once: true });
  }
  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
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
    } catch {
    }
  }
  return finalResult;
}
var __filename, __dirname, DEFAULT_PORT, DEFAULT_HOST, TOKEN_PATH, http;
var init_http = __esm({
  "src/cli/http.js"() {
    __filename = fileURLToPath(import.meta.url);
    __dirname = path.dirname(__filename);
    DEFAULT_PORT = parseInt(process.env.APX_PORT || "7430", 10);
    DEFAULT_HOST = process.env.APX_HOST || "127.0.0.1";
    TOKEN_PATH = path.join(os.homedir(), ".apx", "daemon.token");
    http = {
      get: (p, opts) => request("GET", p, void 0, opts),
      post: (p, body, opts) => request("POST", p, body, opts),
      streamPost: (p, body, onEvent, opts) => streamRequest("POST", p, body, onEvent, opts),
      put: (p, body, opts) => request("PUT", p, body, opts),
      patch: (p, body, opts) => request("PATCH", p, body, opts),
      delete: (p, opts) => request("DELETE", p, void 0, opts),
      baseUrl,
      ping,
      /** Create a fresh AbortController for cancelling in-flight requests. */
      createAbortController: () => new AbortController()
    };
  }
});

// src/cli-ts/index.ts
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// src/cli-ts/http.ts
var _http = null;
async function getHttp() {
  if (!_http) {
    const m = await Promise.resolve().then(() => (init_http(), http_exports));
    _http = m.http;
  }
  return _http;
}

// src/cli-ts/ui.ts
import { createInterface } from "node:readline";
var Style = {
  TEXT_HIGHLIGHT: "\x1B[96m",
  TEXT_DIM: "\x1B[90m",
  TEXT_NORMAL: "\x1B[0m",
  TEXT_WARNING: "\x1B[93m",
  TEXT_DANGER: "\x1B[91m",
  TEXT_SUCCESS: "\x1B[92m",
  TEXT_INFO: "\x1B[94m",
  TEXT_BOLD: "\x1B[1m",
  TEXT_BOLD_END: "\x1B[22m"
};
var _lastEmpty = false;
function println(...parts) {
  _lastEmpty = false;
  process.stderr.write(parts.join(" ") + "\n");
}
function error(message) {
  println(Style.TEXT_DANGER + "\u2716 " + Style.TEXT_NORMAL + message);
}
function success(message) {
  println(Style.TEXT_SUCCESS + "\u2714 " + Style.TEXT_NORMAL + message);
}
function dim(message) {
  return Style.TEXT_DIM + message + Style.TEXT_NORMAL;
}
function highlight(message) {
  return Style.TEXT_HIGHLIGHT + message + Style.TEXT_NORMAL;
}
function bold(message) {
  return Style.TEXT_BOLD + message + Style.TEXT_BOLD_END;
}
function table(rows, cols) {
  const widths = cols.map(
    (col) => Math.max(col.length, ...rows.map((r) => (r[col] ?? "").length))
  );
  const header = cols.map((col, i) => bold(col.padEnd(widths[i]))).join("  ");
  println(header);
  println(dim("\u2500".repeat(widths.reduce((a, b) => a + b + 2, -2))));
  for (const row of rows) {
    println(cols.map((col, i) => (row[col] ?? "").padEnd(widths[i])).join("  "));
  }
}

// src/cli-ts/commands/session.ts
async function resolveProjectId(project) {
  const http2 = await getHttp();
  const projects = await http2.get("/projects");
  if (!projects?.length) throw new Error("No projects registered. Run: apx init");
  if (project) {
    const match = projects.find(
      (p) => p.id === project || p.name === project || p.path === project || p.path?.endsWith("/" + project)
    );
    if (!match) throw new Error(`Project not found: ${project}`);
    return match.id;
  }
  return projects[0].id;
}
var listCmd = {
  command: "list",
  aliases: ["ls"],
  describe: "List sessions for the current project",
  builder: (yargs2) => yargs2.option("last", {
    alias: "n",
    type: "number",
    default: 20,
    describe: "Number of recent sessions to show"
  }).option("format", {
    choices: ["table", "json"],
    default: "table",
    describe: "Output format"
  }),
  handler: async (args) => {
    try {
      const http2 = await getHttp();
      const pid = await resolveProjectId(args.project);
      const sessions = await http2.get(`/projects/${pid}/sessions`);
      if (!sessions?.length) {
        println(dim("No sessions found."));
        return;
      }
      const slice = sessions.slice(-args.last);
      if (args.format === "json") {
        process.stdout.write(JSON.stringify(slice, null, 2) + "\n");
        return;
      }
      table(
        slice.map((s) => ({
          Title: s.title || s.filename || "(no title)",
          Agent: s.agent || "-",
          Started: s.started_at ? new Date(s.started_at).toLocaleString() : "-",
          Status: s.status || "open"
        })),
        ["Title", "Agent", "Started", "Status"]
      );
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var newCmd = {
  command: "new",
  describe: "Create a new session",
  builder: (yargs2) => yargs2.option("title", {
    type: "string",
    describe: "Session title"
  }).option("body", {
    type: "string",
    describe: "Initial session body / context"
  }).option("agent", {
    type: "string",
    describe: "Agent slug to associate the session with"
  }),
  handler: async (args) => {
    try {
      const http2 = await getHttp();
      const pid = await resolveProjectId(args.project);
      const agentSlug = args.agent || "default";
      const session = await http2.post(`/projects/${pid}/agents/${agentSlug}/sessions`, {
        title: args.title || `Session ${(/* @__PURE__ */ new Date()).toLocaleDateString()}`,
        body: args.body
      });
      success(`Session created: ${highlight(session.filename)}`);
      if (session.path) println(dim(session.path));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var getCmd = {
  command: "get <id>",
  aliases: ["show"],
  describe: "Show a session by filename or ID",
  builder: (yargs2) => yargs2.positional("id", { type: "string", demandOption: true, describe: "Session filename or ID" }).option("body", {
    type: "boolean",
    default: false,
    describe: "Print session body / markdown"
  }),
  handler: async (args) => {
    try {
      const http2 = await getHttp();
      const pid = await resolveProjectId(args.project);
      const session = await http2.get(`/projects/${pid}/sessions/${args.id}`);
      if (args.body) {
        process.stdout.write(String(session.body_md || session.body || "") + "\n");
        return;
      }
      process.stdout.write(JSON.stringify(session, null, 2) + "\n");
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var deleteCmd = {
  command: "delete <id>",
  aliases: ["rm"],
  describe: "Delete a session",
  builder: (yargs2) => yargs2.positional("id", { type: "string", demandOption: true, describe: "Session filename or ID" }),
  handler: async (args) => {
    try {
      const http2 = await getHttp();
      const pid = await resolveProjectId(args.project);
      await http2.delete(`/projects/${pid}/sessions/${args.id}`);
      success(`Session deleted: ${args.id}`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var compactCmd = {
  command: "compact [id]",
  describe: "Summarize and compact a session's conversation history",
  builder: (yargs2) => yargs2.positional("id", { type: "string", describe: "Session ID (defaults to latest)" }).option("model", { type: "string", describe: "Model to use for summarization" }),
  handler: async (args) => {
    try {
      const http2 = await getHttp();
      const pid = await resolveProjectId(args.project);
      const path2 = args.id ? `/projects/${pid}/sessions/${args.id}/compact` : `/sessions/${pid}/compact`;
      const result = await http2.post(path2, { model: args.model, project: pid });
      success(`Compacted ${result.compacted_turns ?? "?"} turns.`);
      if (result.summary) println(dim(result.summary));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var sessionCmd = {
  command: "session",
  aliases: ["sessions"],
  describe: "Manage APC sessions",
  builder: (yargs2) => yargs2.command(listCmd).command(newCmd).command(getCmd).command(deleteCmd).command(compactCmd).demandCommand(1, "Specify a session subcommand"),
  handler: () => {
  }
};

// src/cli-ts/commands/agent.ts
async function resolveProjectId2(project) {
  const http2 = await getHttp();
  const projects = await http2.get("/projects");
  if (!projects?.length) throw new Error("No projects registered. Run: apx init");
  if (project) {
    const match = projects.find(
      (p) => p.id === project || p.name === project || p.path === project || p.path?.endsWith("/" + project)
    );
    if (!match) throw new Error(`Project not found: ${project}`);
    return match.id;
  }
  return projects[0].id;
}
var listCmd2 = {
  command: "list",
  aliases: ["ls"],
  describe: "List agents in the current project",
  handler: async (args) => {
    try {
      const http2 = await getHttp();
      const pid = await resolveProjectId2(args.project);
      const agents = await http2.get(`/projects/${pid}/agents`);
      if (!agents?.length) {
        println(dim("No agents found."));
        return;
      }
      table(
        agents.map((a) => ({
          Slug: a.slug,
          Role: a.role || "-",
          Model: a.model || "-",
          Description: a.description ? a.description.slice(0, 50) : "-"
        })),
        ["Slug", "Role", "Model", "Description"]
      );
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var getCmd2 = {
  command: "get <slug>",
  aliases: ["show"],
  describe: "Show agent details and memory",
  builder: (yargs2) => yargs2.positional("slug", { type: "string", demandOption: true, describe: "Agent slug" }),
  handler: async (args) => {
    try {
      const project = args.project;
      const slug = args.slug;
      const http2 = await getHttp();
      const pid = await resolveProjectId2(project);
      const agent = await http2.get(`/projects/${pid}/agents/${slug}`);
      process.stdout.write(JSON.stringify(agent, null, 2) + "\n");
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var addCmd = {
  command: "add <slug>",
  aliases: ["create"],
  describe: "Create a new agent",
  builder: (yargs2) => yargs2.positional("slug", { type: "string", demandOption: true, describe: "Agent slug (identifier)" }).option("role", { type: "string", describe: "Agent role (system prompt)" }).option("model", { type: "string", describe: "LLM model (e.g. claude-sonnet-4-6)" }).option("description", { alias: "d", type: "string", describe: "Short description" }).option("skills", { type: "string", describe: "Comma-separated skill list" }).option("language", { type: "string", describe: "Language code (e.g. en, es)" }).option("tools", { type: "string", describe: "Comma-separated allowed tools" }),
  handler: async (args) => {
    try {
      const project = args.project;
      const slug = args.slug;
      const role = args.role;
      const model = args.model;
      const description = args.description;
      const skills = args.skills;
      const language = args.language;
      const tools = args.tools;
      const http2 = await getHttp();
      const pid = await resolveProjectId2(project);
      const agent = await http2.post(`/projects/${pid}/agents`, {
        slug,
        role,
        model,
        description,
        skills: skills?.split(",").map((s) => s.trim()).filter(Boolean),
        language,
        tools: tools?.split(",").map((t) => t.trim()).filter(Boolean)
      });
      success(`Agent created: ${highlight(slug)}`);
      process.stdout.write(JSON.stringify(agent, null, 2) + "\n");
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var memoryCmd = {
  command: "memory <slug>",
  describe: "Read or write agent memory",
  builder: (yargs2) => yargs2.positional("slug", { type: "string", demandOption: true, describe: "Agent slug" }).option("append", { type: "boolean", default: false, describe: "Append stdin to memory" }).option("replace", { type: "boolean", default: false, describe: "Replace memory with stdin" }),
  handler: async (args) => {
    try {
      const project = args.project;
      const slug = args.slug;
      const append = args.append;
      const replace = args.replace;
      const http2 = await getHttp();
      const pid = await resolveProjectId2(project);
      if (append || replace) {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        if (append) {
          const existing = await http2.get(`/projects/${pid}/agents/${slug}/memory`);
          await http2.put(`/projects/${pid}/agents/${slug}/memory`, { body: (existing.body || "") + "\n" + body });
        } else {
          await http2.put(`/projects/${pid}/agents/${slug}/memory`, { body });
        }
        success("Memory updated.");
      } else {
        const mem = await http2.get(`/projects/${pid}/agents/${slug}/memory`);
        process.stdout.write(mem.body || "");
      }
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var agentCmd = {
  command: "agent",
  aliases: ["agents"],
  describe: "Manage APC agents",
  builder: (yargs2) => yargs2.command(listCmd2).command(getCmd2).command(addCmd).command(memoryCmd).demandCommand(1, "Specify an agent subcommand"),
  handler: () => {
  }
};

// src/cli-ts/commands/mcp.ts
async function resolveProjectId3(project) {
  const http2 = await getHttp();
  const projects = await http2.get("/projects");
  if (!projects?.length) throw new Error("No projects registered. Run: apx init");
  if (project) {
    const match = projects.find(
      (p) => p.id === project || p.name === project || p.path === project || p.path?.endsWith("/" + project)
    );
    if (!match) throw new Error(`Project not found: ${project}`);
    return match.id;
  }
  return projects[0].id;
}
var listCmd3 = {
  command: "list",
  aliases: ["ls"],
  describe: "List registered MCP servers",
  handler: async (args) => {
    try {
      const http2 = await getHttp();
      const pid = await resolveProjectId3(args.project);
      const mcps = await http2.get(`/projects/${pid}/mcps`);
      if (!mcps?.length) {
        println(dim("No MCP servers configured."));
        return;
      }
      table(
        mcps.map((m) => ({
          Name: m.name,
          Transport: m.transport || "-",
          Enabled: m.enabled ? "\u2713" : "\u2717",
          Source: m.source || "-"
        })),
        ["Name", "Transport", "Enabled", "Source"]
      );
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var addCmd2 = {
  command: "add <name>",
  describe: "Register an MCP server",
  builder: (yargs2) => yargs2.positional("name", { type: "string", demandOption: true, describe: "MCP server name" }).option("command", { alias: "c", type: "string", describe: "Command to launch MCP server" }).option("url", { type: "string", describe: "Remote MCP server URL (for HTTP transport)" }).option("env", {
    type: "array",
    string: true,
    describe: "Environment variables (KEY=VALUE)"
  }).option("enabled", { type: "boolean", default: true, describe: "Enable the server" }),
  handler: async (args) => {
    try {
      const project = args.project;
      const name = args.name;
      const command = args.command;
      const url = args.url;
      const env = args.env;
      const enabled = args.enabled;
      const http2 = await getHttp();
      const pid = await resolveProjectId3(project);
      const envRecord = {};
      for (const e of env ?? []) {
        const idx = e.indexOf("=");
        if (idx > 0) envRecord[e.slice(0, idx)] = e.slice(idx + 1);
      }
      const body = {
        name,
        enabled
      };
      if (command) body.command = command;
      if (url) body.url = url;
      if (Object.keys(envRecord).length) body.env = envRecord;
      await http2.post(`/projects/${pid}/mcps`, body);
      success(`MCP server registered: ${highlight(name)}`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var removeCmd = {
  command: "remove <name>",
  aliases: ["rm"],
  describe: "Remove an MCP server",
  builder: (yargs2) => yargs2.positional("name", { type: "string", demandOption: true, describe: "MCP server name" }),
  handler: async (args) => {
    try {
      const project = args.project;
      const name = args.name;
      const http2 = await getHttp();
      const pid = await resolveProjectId3(project);
      await http2.delete(`/projects/${pid}/mcps/${name}`);
      success(`MCP server removed: ${name}`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var enableCmd = {
  command: "enable <name>",
  describe: "Enable an MCP server",
  builder: (yargs2) => yargs2.positional("name", { type: "string", demandOption: true }),
  handler: async (args) => {
    try {
      const project = args.project;
      const name = args.name;
      const http2 = await getHttp();
      const pid = await resolveProjectId3(project);
      await http2.post(`/projects/${pid}/mcps`, { name, enabled: true });
      success(`Enabled: ${name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  }
};
var disableCmd = {
  command: "disable <name>",
  describe: "Disable an MCP server",
  builder: (yargs2) => yargs2.positional("name", { type: "string", demandOption: true }),
  handler: async (args) => {
    try {
      const project = args.project;
      const name = args.name;
      const http2 = await getHttp();
      const pid = await resolveProjectId3(project);
      await http2.post(`/projects/${pid}/mcps`, { name, enabled: false });
      success(`Disabled: ${name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  }
};
var toolsCmd = {
  command: "tools <name>",
  describe: "List tools exposed by an MCP server",
  builder: (yargs2) => yargs2.positional("name", { type: "string", demandOption: true }),
  handler: async (args) => {
    try {
      const project = args.project;
      const name = args.name;
      const http2 = await getHttp();
      const pid = await resolveProjectId3(project);
      const result = await http2.post(`/mcp/run`, {
        project: pid,
        name,
        tool: "list_tools",
        params: {}
      });
      const tools = result?.result?.tools ?? [];
      if (!tools.length) {
        println(dim("No tools found."));
        return;
      }
      table(
        tools.map((t) => ({ Tool: t.name, Description: t.description?.slice(0, 60) || "-" })),
        ["Tool", "Description"]
      );
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var checkCmd = {
  command: "check",
  describe: "Validate MCP configuration",
  handler: async (args) => {
    try {
      const http2 = await getHttp();
      const pid = await resolveProjectId3(args.project);
      const result = await http2.get(`/projects/${pid}/mcps/check`);
      if (result.conflicts?.length) {
        println("\x1B[93m\u26A0 Conflicts:\x1B[0m");
        result.conflicts.forEach((c) => println("  " + c));
      }
      result.entries?.forEach((e) => {
        if (e.ok) success(e.name);
        else error(`${e.name}: ${e.error}`);
      });
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var mcpCmd = {
  command: "mcp",
  describe: "Manage MCP (Model Context Protocol) servers",
  builder: (yargs2) => yargs2.command(listCmd3).command(addCmd2).command(removeCmd).command(enableCmd).command(disableCmd).command(toolsCmd).command(checkCmd).demandCommand(1, "Specify an mcp subcommand"),
  handler: () => {
  }
};

// src/cli-ts/commands/daemon.ts
import { spawn as spawn2 } from "node:child_process";
var statusCmd = {
  command: "status",
  describe: "Show daemon status",
  handler: async () => {
    try {
      const http2 = await getHttp();
      const health = await http2.get("/health");
      success(`Daemon running  version=${health.version ?? "?"}  uptime=${health.uptime_s ?? "?"}s`);
    } catch {
      error("Daemon is not running.");
      process.exit(1);
    }
  }
};
var startCmd = {
  command: "start",
  describe: "Start the APX daemon in the background",
  handler: async () => {
    try {
      const http2 = await getHttp();
      await http2.get("/health");
      println(dim("Daemon is already running."));
    } catch {
      const daemon = spawn2("apx-daemon", [], {
        detached: true,
        stdio: "ignore"
      });
      daemon.unref();
      success("Daemon started.");
    }
  }
};
var stopCmd = {
  command: "stop",
  describe: "Gracefully stop the APX daemon",
  handler: async () => {
    try {
      const http2 = await getHttp();
      await http2.post("/admin/shutdown", {});
      success("Daemon stopped.");
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var logsCmd = {
  command: "logs",
  describe: "Stream daemon logs",
  builder: (yargs2) => yargs2.option("tail", {
    alias: "n",
    type: "number",
    default: 50,
    describe: "Number of lines to show"
  }),
  handler: async (args) => {
    try {
      const tail = args.tail ?? 50;
      const { homedir } = await import("node:os");
      const { createReadStream } = await import("node:fs");
      const { createInterface: createInterface3 } = await import("node:readline");
      const logPath = `${homedir()}/.apx/daemon.log`;
      try {
        const rl = createInterface3({ input: createReadStream(logPath), crlfDelay: Infinity });
        const lines = [];
        for await (const line of rl) lines.push(line);
        const tailLines = lines.slice(-tail);
        tailLines.forEach((l) => println(l));
      } catch {
        error(`Log file not found: ${logPath}`);
        process.exit(1);
      }
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};
var daemonCmd = {
  command: "daemon",
  describe: "Manage the APX background daemon",
  builder: (yargs2) => yargs2.command(statusCmd).command(startCmd).command(stopCmd).command(logsCmd).demandCommand(1, "Specify a daemon subcommand"),
  handler: () => {
  }
};

// src/cli-ts/commands/status.ts
var statusCmd2 = {
  command: "status",
  describe: "Show APX system health and project overview",
  handler: async (args) => {
    try {
      const http2 = await getHttp();
      let daemonOk = false;
      try {
        const health = await http2.get("/health");
        println(
          "\x1B[92m\u25CF\x1B[0m Daemon  " + dim(`v${health.version ?? "?"}`) + "  uptime " + dim(`${health.uptime_s ?? "?"}s`)
        );
        daemonOk = true;
      } catch {
        println("\x1B[91m\u2717\x1B[0m Daemon  " + dim("not running \u2014 run: apx daemon start"));
      }
      if (!daemonOk) {
        process.exit(1);
        return;
      }
      const projects = await http2.get("/projects");
      println("");
      println(bold("Projects") + "  " + dim(`(${projects?.length ?? 0})`));
      if (!projects?.length) {
        println(dim("  No projects. Run: apx init <path>"));
      } else {
        for (const p of projects) {
          const isActive = !args.project || p.name === args.project || p.id === args.project;
          println(
            (isActive ? "\x1B[94m\u25B6\x1B[0m" : " ") + " " + highlight(p.name ?? p.id) + "  " + dim(p.path)
          );
        }
      }
      try {
        const eng = await http2.get("/engines");
        if (eng?.engines?.length) {
          println("");
          println(bold("Engines") + "  " + dim(`(${eng.engines.length})`));
          println(dim("  " + eng.engines.slice(0, 6).join("  ") + (eng.engines.length > 6 ? "  \u2026" : "")));
        }
      } catch {
      }
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};

// src/cli-ts/commands/exec.ts
async function resolveProjectId4(project) {
  const http2 = await getHttp();
  const projects = await http2.get("/projects");
  if (!projects?.length) throw new Error("No projects registered. Run: apx init");
  if (project) {
    const match = projects.find(
      (p) => p.id === project || p.name === project || p.path === project || p.path?.endsWith("/" + project)
    );
    if (!match) throw new Error(`Project not found: ${project}`);
    return match.id;
  }
  return projects[0].id;
}
var execCmd = {
  command: "exec <agent> [prompt..]",
  aliases: ["run"],
  describe: "Run a one-shot prompt through an agent (non-interactive)",
  builder: (yargs2) => yargs2.positional("agent", { type: "string", demandOption: true, describe: "Agent slug" }).positional("prompt", { type: "string", array: true, describe: "Prompt text" }).option("model", { type: "string", describe: "Override model" }).option("max-tokens", { type: "number", describe: "Max output tokens" }).option("temperature", { type: "number", describe: "Sampling temperature (0\u20131)" }).option("format", {
    choices: ["text", "json"],
    default: "text",
    describe: "Output format"
  }).option("stream", {
    type: "boolean",
    default: true,
    describe: "Stream output as it arrives"
  }),
  handler: async (args) => {
    try {
      const project = args.project;
      const agent = args.agent;
      const promptArgs = args.prompt;
      const model = args.model;
      const maxTokens = args.maxTokens;
      const temperature = args.temperature;
      const format = args.format;
      const stream = args.stream;
      let prompt = (promptArgs ?? []).join(" ");
      if (!process.stdin.isTTY) {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        const piped = Buffer.concat(chunks).toString().trim();
        if (piped) prompt = prompt ? prompt + "\n\n" + piped : piped;
      }
      if (!prompt) throw new Error("No prompt provided. Pass text as argument or via stdin.");
      const http2 = await getHttp();
      const pid = await resolveProjectId4(project);
      const body = {
        prompt,
        model,
        maxTokens,
        temperature
      };
      if (stream) {
        try {
          const result2 = await http2.streamPost(
            `/projects/${pid}/super-agent/chat/stream`,
            { ...body, contextNote: `Agent: ${agent}` },
            (ev) => {
              if (ev.type === "chunk" && typeof ev.chunk === "string") {
                process.stdout.write(ev.chunk);
              }
              if (ev.type === "event" && ev.event === "assistant_text" && typeof ev.text === "string") {
                process.stdout.write(ev.text);
              }
            }
          );
          if (!result2?.text) process.stdout.write("\n");
          return;
        } catch {
        }
      }
      const result = await http2.post(`/projects/${pid}/agents/${agent}/exec`, body);
      if (format === "json") {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        process.stdout.write(result.text + "\n");
      }
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};

// src/cli-ts/commands/chat.ts
import { createInterface as createInterface2 } from "node:readline";
async function resolveProjectId5(project) {
  const http2 = await getHttp();
  const projects = await http2.get("/projects");
  if (!projects?.length) throw new Error("No projects registered. Run: apx init");
  if (project) {
    const match = projects.find(
      (p) => p.id === project || p.name === project || p.path === project || p.path?.endsWith("/" + project)
    );
    if (!match) throw new Error(`Project not found: ${project}`);
    return match.id;
  }
  return projects[0].id;
}
var chatCmd = {
  command: "chat [agent]",
  describe: "Start an interactive multi-turn chat with an agent",
  builder: (yargs2) => yargs2.positional("agent", {
    type: "string",
    default: "default",
    describe: "Agent slug (defaults to super-agent)"
  }).option("model", { type: "string", describe: "Override model" }).option("conversation", {
    alias: "c",
    type: "string",
    describe: "Continue an existing conversation ID"
  }),
  handler: async (args) => {
    try {
      const project = args.project;
      const agent = args.agent;
      const model = args.model;
      const http2 = await getHttp();
      const pid = await resolveProjectId5(project);
      let conversationId = args.conversation;
      if (!process.stdin.isTTY) {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        const prompt = Buffer.concat(chunks).toString().trim();
        if (!prompt) throw new Error("No prompt provided via stdin.");
        const result = await http2.post(`/projects/${pid}/agents/${agent}/chat`, {
          prompt,
          model,
          conversation_id: conversationId
        });
        process.stdout.write(result.text + "\n");
        return;
      }
      println(dim(`APX Chat \u2014 agent: ${agent}  (type /exit or ctrl+c to quit)`));
      const rl = createInterface2({ input: process.stdin, output: process.stderr, terminal: true });
      rl.setPrompt("\x1B[96m> \x1B[0m");
      rl.prompt();
      rl.on("line", async (line) => {
        const text = line.trim();
        if (!text) {
          rl.prompt();
          return;
        }
        if (text === "/exit" || text === "/quit") {
          rl.close();
          return;
        }
        rl.pause();
        try {
          let responded = false;
          try {
            const result = await http2.streamPost(
              `/projects/${pid}/super-agent/chat/stream`,
              { prompt: text, model, previousMessages: [] },
              (ev) => {
                if (ev.type === "chunk" && typeof ev.chunk === "string") {
                  process.stdout.write(ev.chunk);
                  responded = true;
                }
              }
            );
            if (!responded && result?.text) process.stdout.write(result.text);
            process.stdout.write("\n");
          } catch {
            const result = await http2.post(`/projects/${pid}/agents/${agent}/chat`, {
              prompt: text,
              model,
              conversation_id: conversationId
            });
            conversationId = result.conversation_id;
            process.stdout.write(result.text + "\n");
          }
        } catch (err) {
          error(err instanceof Error ? err.message : String(err));
        }
        rl.resume();
        rl.prompt();
      });
      rl.on("close", () => {
        println(dim("\nGoodbye."));
        process.exit(0);
      });
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
};

// src/cli-ts/index.ts
process.on("unhandledRejection", (err) => {
  process.stderr.write(
    "\x1B[91m\u2716 Unhandled error:\x1B[0m " + String(err) + "\n"
  );
  process.exit(1);
});
yargs(hideBin(process.argv)).scriptName("apx").usage("$0 <command> [options]").version(false).option("project", {
  alias: "p",
  type: "string",
  describe: "Project name, ID, or path",
  global: true
}).option("json", {
  type: "boolean",
  describe: "Output as JSON",
  global: false
}).command(sessionCmd).command(agentCmd).command(mcpCmd).command(daemonCmd).command(statusCmd2).command(execCmd).command(chatCmd).command({
  command: "version",
  aliases: ["--version", "-v"],
  describe: "Print APX version",
  handler: async () => {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    try {
      const pkg = req("../../package.json");
      process.stdout.write(pkg.version + "\n");
    } catch {
      process.stdout.write("unknown\n");
    }
  }
}).demandCommand(1, "Specify a command. Use --help for available commands.").strict().wrap(Math.min(100, yargs().terminalWidth())).help().alias("help", "h").fail((msg, err) => {
  if (err) throw err;
  process.stderr.write("\x1B[91m\u2716 " + msg + "\x1B[0m\n\n");
  process.exit(1);
}).parseAsync().catch((err) => {
  process.stderr.write("\x1B[91m\u2716 " + err.message + "\x1B[0m\n");
  process.exit(1);
});
