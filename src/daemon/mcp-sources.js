// Multi-source MCP discovery: read .apc/mcps.json plus configs from coexisting
// AI tools (Cursor, Claude Code, VS Code, Roo, etc.) and merge them with APC
// taking precedence. Read-only — never modifies any external file.
//
// References (formats validated against official docs):
//   .apc/mcps.json                  APC (this project)              key: mcpServers
//   .mcp.json                       Claude Code (project scope)     key: mcpServers
//   .cursor/mcp.json                Cursor                          key: mcpServers
//   .vscode/mcp.json                VS Code / Copilot               key: servers (different!)
//   .roo/mcp.json                   Roo Code                        key: mcpServers
//   .gemini/settings.json           Gemini CLI                      key: mcpServers
//
// Priority (first wins by name):
//   1. apc  — .apc/mcps.json
//   2. claude — .mcp.json
//   3. cursor — .cursor/mcp.json
//   4. vscode — .vscode/mcp.json
//   5. roo    — .roo/mcp.json
//   6. gemini — .gemini/settings.json
//
// Each entry returns:
//   { name, source, command?, args?, env?, url?, headers?, enabled, raw }
// `enabled` is APC's extension. Falls back to !disabled if the source uses that
// instead, then to true.

import fs from "node:fs";
import path from "node:path";

export const SOURCES = [
  { id: "apc",    file: ".apc/mcps.json",      key: "mcpServers" },
  { id: "claude", file: ".mcp.json",           key: "mcpServers" },
  { id: "cursor", file: ".cursor/mcp.json",    key: "mcpServers" },
  { id: "vscode", file: ".vscode/mcp.json",    key: "servers"    },
  { id: "roo",    file: ".roo/mcp.json",       key: "mcpServers" },
  { id: "gemini", file: ".gemini/settings.json", key: "mcpServers" },
];

export function loadAll(projectRoot) {
  const merged = new Map(); // name -> entry (first writer wins)
  const conflicts = []; // [{name, winner, loser, sources}]
  const sourceMap = {}; // sourceId -> count

  for (const src of SOURCES) {
    const abs = path.join(projectRoot, src.file);
    if (!fs.existsSync(abs)) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
      continue;
    }
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

// Read just .apc/mcps.json and return the parsed object (for editing).
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
