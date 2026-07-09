// Generic plugin → MCP reconcile. A plugin may expose an optional
// `mcpServer(record)` hook returning `{ name, def }` (def:null → should not
// exist). The daemon calls reconcilePluginMcp after every lifecycle change so
// an integration can keep an auto-registered MCP server in lockstep with its
// state. Today only the Obsidian plugin uses it (opt-in `auto_mcp`).
import {
  readRuntimeMcps,
  writeRuntimeMcps,
  readGlobalMcps,
  writeGlobalMcps,
} from "#core/mcp/sources.js";

// Map an integration scope to the MCP scope its auto-registered servers live in.
// Auto-registered servers point at machine-local paths, so project→runtime
// (per-project, never committed, chmod 0600) and global→global (machine-wide).
// We deliberately avoid the committed `.apc/mcps.json` (shared) scope.
function mcpScopeFor(integrationScope) {
  return integrationScope === "global" ? "global" : "runtime";
}

function readMcpScope(scope, project) {
  return scope === "global" ? readGlobalMcps() : readRuntimeMcps(project.storagePath);
}

function writeMcpScope(scope, project, json) {
  return scope === "global" ? writeGlobalMcps(json) : writeRuntimeMcps(project.storagePath, json);
}

// Reconcile a plugin's desired MCP server against the store, then evict live
// registries so agents pick up the change (mirrors host/daemon/api/mcps.js).
// `desired` = { name, def } from svc.mcpServer(record); def:null removes it.
export function reconcilePluginMcp({ desired, integrationScope, project, projects, registries }) {
  if (!desired || !desired.name) return { changed: false, reason: "no-hook" };
  const scope = mcpScopeFor(integrationScope);
  if (scope === "runtime" && !project?.storagePath) {
    return { changed: false, reason: "no-storage" };
  }

  const json = readMcpScope(scope, project) || {};
  json.mcpServers = json.mcpServers || {};
  const existing = json.mcpServers[desired.name];

  let action = "none";
  if (desired.def === null) {
    if (existing) {
      delete json.mcpServers[desired.name];
      action = "removed";
    }
  } else {
    const next = { ...(existing || {}), ...desired.def };
    if (JSON.stringify(existing ?? null) !== JSON.stringify(next)) {
      action = existing ? "updated" : "added";
    }
    json.mcpServers[desired.name] = next;
  }

  if (action === "none") return { changed: false, scope, name: desired.name };

  writeMcpScope(scope, project, json);
  try {
    registries?.shutdown?.();
  } catch {
    /* best-effort — a rebuild below still refreshes the registry */
  }
  try {
    projects?.rebuild?.(project?.id);
  } catch {
    /* best-effort */
  }
  return { changed: true, scope, name: desired.name, action };
}
