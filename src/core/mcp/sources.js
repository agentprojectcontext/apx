// Multi-source MCP discovery: read MCPs from three primary APX scopes plus
// configs from coexisting AI tools (Cursor, Claude Code, VS Code, Roo, etc.).
// All discoverable files are read-only; APX-owned writes target apc / runtime /
// global only.
//
// APX scopes (writable by APX):
//   1. runtime — <storagePath>/mcps.json (a.k.a. ~/.apx/projects/<apxId>/mcps.json)
//                Per-project, machine-local, NEVER committed. Holds tokens and
//                user-specific endpoints. File is chmod 0600.
//   2. apc     — .apc/mcps.json in the repo. Project-shared, committable.
//   3. global  — ~/.apx/mcps.json (machine-wide). Shared across projects on
//                this machine, not committed.
//
// Foreign-IDE scopes (read-only, never written by APX):
//   claude — .mcp.json                     key: mcpServers
//   cursor — .cursor/mcp.json              key: mcpServers
//   vscode — .vscode/mcp.json              key: servers (different!)
//   roo    — .roo/mcp.json                 key: mcpServers
//   gemini — .gemini/settings.json         key: mcpServers
//
// Priority (first wins by name; conflicts are reported):
//   1. runtime   (highest — per-project secrets win)
//   2. apc       (project-shared)
//   3. claude
//   4. cursor
//   5. vscode
//   6. roo
//   7. gemini
//   8. global    (lowest — machine-wide fallback)
//
// Each entry returns:
//   { name, source, command?, args?, env?, url?, headers?, enabled, raw }
// `enabled` is APC's extension. Falls back to !disabled if the source uses that
// instead, then to true.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APX_HOME = path.join(os.homedir(), ".apx");
const GLOBAL_MCPS_FILE = path.join(APX_HOME, "mcps.json");
const RUNTIME_MCPS_FILENAME = "mcps.json";

// Project-relative sources (file path resolved against projectRoot).
// `id: 'apc'` is APX's primary project-shared store. The rest are read-only
// foreign IDE configs included so APC sees what the user already configured.
export const PROJECT_SOURCES = [
  { id: "apc",    file: ".apc/mcps.json",      key: "mcpServers" },
  { id: "claude", file: ".mcp.json",           key: "mcpServers" },
  { id: "cursor", file: ".cursor/mcp.json",    key: "mcpServers" },
  { id: "vscode", file: ".vscode/mcp.json",    key: "servers"    },
  { id: "roo",    file: ".roo/mcp.json",       key: "mcpServers" },
  { id: "gemini", file: ".gemini/settings.json", key: "mcpServers" },
];

// SOURCES is the full ordered list (for discovery/check). Runtime path depends
// on the storagePath of the project; we expose a placeholder entry whose
// `file` is left as a hint, but the actual read path is computed in loadAll.
export const SOURCES = [
  { id: "runtime", file: "~/.apx/projects/<apxId>/mcps.json", key: "mcpServers", scope: "runtime" },
  ...PROJECT_SOURCES.map((s) => ({ ...s, scope: "project" })),
  { id: "global",  file: "~/.apx/mcps.json", key: "mcpServers", scope: "global" },
];

function readJsonSafe(absPath) {
  if (!absPath) return null;
  if (!fs.existsSync(absPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

// Resolve the runtime mcps.json path for a given project. `storagePath` is the
// project's ~/.apx/projects/<apxId>/ directory.
export function runtimeMcpsPath(storagePath) {
  if (!storagePath) return null;
  return path.join(storagePath, RUNTIME_MCPS_FILENAME);
}

export function globalMcpsPath() {
  return GLOBAL_MCPS_FILE;
}

// Aggregate all MCP sources for a project, in priority order.
// Backwards-compatible call signature: loadAll(projectRoot) still works.
//   loadAll(projectRoot)                          // no runtime
//   loadAll(projectRoot, { storagePath })         // include runtime if file exists
export function loadAll(projectRoot, opts = {}) {
  const storagePath = opts.storagePath || null;
  const merged = new Map(); // name -> entry (first writer wins)
  const conflicts = []; // [{name, winner, loser}]
  const sourceMap = {}; // sourceId -> count

  const pipeline = [];

  // 1. runtime (highest)
  if (storagePath) {
    pipeline.push({
      id: "runtime",
      abs: runtimeMcpsPath(storagePath),
      key: "mcpServers",
    });
  }

  // 2..N. project-relative sources (apc + IDE configs)
  if (projectRoot) {
    for (const src of PROJECT_SOURCES) {
      pipeline.push({
        id: src.id,
        abs: path.join(projectRoot, src.file),
        key: src.key,
      });
    }
  }

  // last. global
  pipeline.push({
    id: "global",
    abs: GLOBAL_MCPS_FILE,
    key: "mcpServers",
  });

  for (const src of pipeline) {
    const raw = readJsonSafe(src.abs);
    if (!raw) continue;
    const dict = raw[src.key] || {};
    sourceMap[src.id] = 0;
    for (const [name, server] of Object.entries(dict)) {
      sourceMap[src.id]++;
      const entry = normalize(name, server, src.id);
      if (merged.has(name)) {
        const winner = merged.get(name);
        conflicts.push({
          name,
          winner: winner.source,
          loser: src.id,
        });
      } else {
        merged.set(name, entry);
      }
    }
  }
  return {
    entries: Array.from(merged.values()),
    conflicts,
    sourceCounts: sourceMap,
  };
}

function normalize(name, server, sourceId) {
  const enabled =
    server.enabled === false
      ? false
      : server.disabled === true
      ? false
      : true;
  return {
    name,
    source: sourceId,
    command: server.command || null,
    args: server.args || [],
    env: server.env || {},
    url: server.url || null,
    headers: server.headers || null,
    transport: server.url ? "http" : "stdio",
    enabled,
    raw: server,
  };
}

// ---------------------------------------------------------------------------
// apc scope (project-shared, .apc/mcps.json)
// ---------------------------------------------------------------------------

export function readApfMcps(projectRoot) {
  const p = path.join(projectRoot, ".apc", "mcps.json");
  if (!fs.existsSync(p)) return { mcpServers: {} };
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!json.mcpServers) json.mcpServers = {};
    return json;
  } catch {
    return { mcpServers: {} };
  }
}

export function writeApfMcps(projectRoot, json) {
  const p = path.join(projectRoot, ".apc", "mcps.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// runtime scope (per-project, ~/.apx/projects/<apxId>/mcps.json)
// File is chmod 0600 — may contain tokens.
// ---------------------------------------------------------------------------

export function readRuntimeMcps(storagePath) {
  if (!storagePath) return { mcpServers: {} };
  const p = runtimeMcpsPath(storagePath);
  if (!fs.existsSync(p)) return { mcpServers: {} };
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!json.mcpServers) json.mcpServers = {};
    return json;
  } catch {
    return { mcpServers: {} };
  }
}

export function writeRuntimeMcps(storagePath, json) {
  if (!storagePath) throw new Error("writeRuntimeMcps: storagePath required");
  const p = runtimeMcpsPath(storagePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + "\n");
  // Tokens may live in this file — protect it.
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // chmod is a best-effort on non-POSIX FS (Windows). Ignore errors.
  }
}

// ---------------------------------------------------------------------------
// global scope (machine-wide, ~/.apx/mcps.json)
// ---------------------------------------------------------------------------

export function readGlobalMcps() {
  const p = GLOBAL_MCPS_FILE;
  if (!fs.existsSync(p)) return { mcpServers: {} };
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!json.mcpServers) json.mcpServers = {};
    return json;
  } catch {
    return { mcpServers: {} };
  }
}

export function writeGlobalMcps(json) {
  const p = GLOBAL_MCPS_FILE;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + "\n");
}
