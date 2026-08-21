import {
  readApfMcps, writeApfMcps,
  readRuntimeMcps, writeRuntimeMcps,
  readGlobalMcps, writeGlobalMcps,
} from "#core/mcp/sources.js";
import { projectMeta, resolveProject } from "../helpers.js";

// Register an MCP server. The super-agent could LIST mcps and CALL their tools
// but not add one — so wiring a new MCP meant shelling out to `apx mcp add`,
// the same gap that made building an agent painful. This closes it.
//
// Three scopes (see the apx-mcp skill), each a different file with different
// commit/secrecy semantics:
//   shared  → .apc/mcps.json  (committed; NON-SECRET hints only)
//   runtime → ~/.apx/projects/<id>/mcps.json  (private; where SECRETS live)
//   global  → ~/.apx/mcps.json  (private; every project)
function readScope(scope, p) {
  if (scope === "runtime") return readRuntimeMcps(p.storagePath);
  if (scope === "global") return readGlobalMcps();
  return readApfMcps(p.path);
}
function writeScope(scope, p, json) {
  if (scope === "runtime") {
    if (!p.storagePath) throw new Error("runtime scope requires a project with a storage path");
    return writeRuntimeMcps(p.storagePath, json);
  }
  if (scope === "global") return writeGlobalMcps(json);
  return writeApfMcps(p.path, json);
}

export default {
  name: "add_mcp",
  schema: {
    type: "function",
    function: {
      name: "add_mcp",
      description:
        "Register (or update) an MCP server so its tools become callable via call_mcp. A stdio server needs `command` (+ optional `args`/`env`); a remote HTTP one needs `url` (+ optional `headers`). Scope decides WHERE it is stored and its secrecy: 'runtime' (default here — private, holds secrets), 'shared' (.apc/mcps.json, committed — NON-SECRET hints only, never a token), or 'global' (private, all projects). Put anything secret in runtime or global, never shared.",
      parameters: {
        type: "object",
        required: ["name"],
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit or 'default' for ~/.apx/projects/default." },
          name:    { type: "string", description: "Server name (how you'll reference it in call_mcp)." },
          command: { type: "string", description: "stdio: the executable to spawn (e.g. 'npx')." },
          args:    { type: "array", items: { type: "string" }, description: "stdio: arguments for the command." },
          env:     { type: "object", description: "stdio: environment variables { KEY: value }." },
          url:     { type: "string", description: "http: the remote endpoint URL." },
          headers: { type: "object", description: "http: request headers { Header: value }." },
          scope:   { type: "string", enum: ["runtime", "shared", "global"], description: "Where to store it. Default: runtime." },
          enabled: { type: "boolean", description: "Enable it now (default true)." },
        },
      },
    },
  },
  makeHandler: ({ projects, registries, requirePermission }) => async (args = {}) => {
    const { project, name, command, args: cmdArgs, env, url, headers, enabled } = args;
    await requirePermission("add_mcp", { dangerous: true, args: { name, scope: args.scope } });
    if (!name) return { error: "name required" };
    if (!command && !url) return { error: "either command (stdio) or url (http) required" };
    if (command && url) return { error: "pass either command (stdio) or url (http), not both" };

    const scope = ["runtime", "shared", "global"].includes(args.scope) ? args.scope
      : args.scope === "apc" ? "shared"
      : args.scope ? null : "runtime";
    if (scope === null) return { error: `unknown scope "${args.scope}" (use runtime|shared|global)` };

    let p;
    try {
      p = resolveProject(projects, project || "default");
    } catch (e) {
      return { error: e.message };
    }

    try {
      const json = readScope(scope, p);
      json.mcpServers = json.mcpServers || {};
      const existing = json.mcpServers[name] || {};
      json.mcpServers[name] = {
        ...existing,
        ...(command !== undefined ? { command } : {}),
        ...(cmdArgs !== undefined ? { args: cmdArgs } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(headers !== undefined ? { headers } : {}),
        enabled: enabled === undefined ? true : !!enabled,
      };
      writeScope(scope, p, json);
      registries?.evictName?.(name);
      projects.rebuild(p.id);
      return {
        ok: true,
        name,
        scope,
        transport: url ? "http" : "stdio",
        project: projectMeta(projects, p),
        hint: "Registered. Use list_mcp_tools to see what it exposes, then call_mcp to run a tool.",
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
