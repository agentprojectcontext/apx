// MCP server registration per project. Reads/writes the three APX-owned scopes
// (apc = .apc/mcps.json, runtime = <storagePath>/mcps.json, global =
// ~/.apx/mcps.json) and exposes tool calls through the registry cache.
//   GET    /projects/:pid/mcps
//   POST   /projects/:pid/mcps?scope=shared|runtime|global    (default: shared)
//   DELETE /projects/:pid/mcps/:name?scope=…                   (default: shared)
//   GET    /projects/:pid/mcps/check
//   GET    /projects/:pid/mcps/:name/tools
//   POST   /projects/:pid/mcps/:name/call
import fs from "node:fs";
import path from "node:path";
import {
  readApfMcps,
  writeApfMcps,
  readRuntimeMcps,
  writeRuntimeMcps,
  readGlobalMcps,
  writeGlobalMcps,
  runtimeMcpsPath,
  globalMcpsPath,
  SOURCES,
} from "#core/mcp/sources.js";

// scope alias used by API/CLI -> internal source id used in entry metadata
const SCOPE_TO_SOURCE = {
  shared: "apc",       // .apc/mcps.json
  runtime: "runtime",  // ~/.apx/projects/<apxId>/mcps.json
  global: "global",    // ~/.apx/mcps.json
};

function readScope(scope, projectEntry) {
  if (scope === "runtime") return readRuntimeMcps(projectEntry.storagePath);
  if (scope === "global") return readGlobalMcps();
  return readApfMcps(projectEntry.path); // shared / default
}

function writeScope(scope, projectEntry, json) {
  if (scope === "runtime") {
    if (!projectEntry.storagePath) {
      throw new Error("runtime scope requires a project with storagePath");
    }
    return writeRuntimeMcps(projectEntry.storagePath, json);
  }
  if (scope === "global") return writeGlobalMcps(json);
  return writeApfMcps(projectEntry.path, json);
}

function normalizeScope(raw) {
  if (!raw) return "shared";
  const s = String(raw).toLowerCase();
  if (s === "apc") return "shared"; // friendly alias
  if (!(s in SCOPE_TO_SOURCE)) {
    return null;
  }
  return s;
}

export function register(app, { projects, registries, project }) {
  app.get("/projects/:pid/mcps", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(registries.for(p).list());
  });

  app.post("/projects/:pid/mcps", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const scope = normalizeScope(req.query?.scope);
    if (scope === null) {
      return res.status(400).json({ error: `unknown scope "${req.query?.scope}" (use shared|runtime|global)` });
    }
    const { name, command, args, env, url, headers, enabled } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });

    let json;
    try {
      json = readScope(scope, p);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    json.mcpServers = json.mcpServers || {};
    const existing = json.mcpServers[name] || {};
    if (!existing.command && !existing.url && !command && !url)
      return res.status(400).json({ error: "either command or url required" });
    json.mcpServers[name] = {
      ...existing,
      ...(command !== undefined ? { command } : {}),
      ...(args !== undefined ? { args } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(headers !== undefined ? { headers } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    };
    try {
      writeScope(scope, p, json);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    registries.shutdown();
    projects.rebuild(p.id);
    const entry = registries.for(p).getByName(name);
    res.status(201).json(entry);
  });

  app.delete("/projects/:pid/mcps/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const scope = normalizeScope(req.query?.scope);
    if (scope === null) {
      return res.status(400).json({ error: `unknown scope "${req.query?.scope}" (use shared|runtime|global)` });
    }
    let json;
    try {
      json = readScope(scope, p);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (!json.mcpServers || !(req.params.name in (json.mcpServers || {}))) {
      // Not present in the requested scope. Surface a helpful message if it
      // lives in another scope/source.
      const all = registries.for(p).list();
      const m = all.find((x) => x.name === req.params.name);
      if (m) {
        const ownerSource = m.source;
        const ownerScope = ownerSource === "apc"
          ? "shared"
          : ownerSource === "runtime"
          ? "runtime"
          : ownerSource === "global"
          ? "global"
          : null;
        if (ownerScope && ownerScope !== scope) {
          return res.status(409).json({
            error: `MCP "${req.params.name}" lives in scope "${ownerScope}", not "${scope}". Re-run with --scope ${ownerScope}.`,
          });
        }
        if (!ownerScope) {
          return res.status(409).json({
            error: `MCP "${req.params.name}" comes from "${ownerSource}" config — not APX-owned, cannot be removed by apx. Edit ${
              SOURCES.find((s) => s.id === ownerSource)?.file
            } directly.`,
          });
        }
      }
      return res.status(404).end();
    }
    delete json.mcpServers[req.params.name];
    try {
      writeScope(scope, p, json);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    registries.shutdown();
    projects.rebuild(p.id);
    res.status(204).end();
  });

  app.get("/projects/:pid/mcps/check", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const reg = registries.for(p);
    res.json({
      sources: SOURCES.map((s) => {
        let abs;
        let present;
        if (s.id === "runtime") {
          abs = runtimeMcpsPath(p.storagePath);
          present = !!(abs && fs.existsSync(abs));
        } else if (s.id === "global") {
          abs = globalMcpsPath();
          present = fs.existsSync(abs);
        } else {
          abs = path.join(p.path, s.file);
          present = fs.existsSync(abs);
        }
        return {
          id: s.id,
          file: s.file,
          path: abs,
          scope: s.scope || "project",
          present,
        };
      }),
      entries: reg.list().map((m) => ({
        name: m.name,
        source: m.source,
        transport: m.transport,
        enabled: m.enabled,
      })),
      conflicts: reg.conflicts(),
    });
  });

  // Full tool catalog — tools/list with input schemas, all pages merged.
  // This is what `apx mcp tools` renders; /test below stays as the
  // lightweight smoke check for the web UI card.
  app.get("/projects/:pid/mcps/:name/tools", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      const result = await registries.for(p).listTools(req.params.name);
      res.json({ tools: Array.isArray(result?.tools) ? result.tools : [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/projects/:pid/mcps/:name/call", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { tool, params } = req.body || {};
    if (!tool) return res.status(400).json({ error: "tool required" });
    try {
      const result = await registries.for(p).call(req.params.name, tool, params);
      res.json({ result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Smoke test — calls tools/list and reports either the tool catalog or a
  // clean error message. Used by the "Test" button in the MCP card so the
  // user can sanity-check a freshly-saved MCP without firing a real tool.
  app.post("/projects/:pid/mcps/:name/test", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      const result = await registries.for(p).listTools(req.params.name);
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      res.json({
        ok: true,
        tool_count: tools.length,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description || "",
        })),
      });
    } catch (e) {
      res.status(200).json({ ok: false, error: e.message });
    }
  });

  // In-memory log buffer for one MCP — stderr tail (stdio) or fetch summary
  // (http) plus a ring of recent events.
  app.get("/projects/:pid/mcps/:name/logs", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const logs = registries.for(p).getLogs(req.params.name);
    if (!logs) return res.status(404).json({ error: "MCP not found" });
    res.json(logs);
  });
}
