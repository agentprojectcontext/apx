// MCP server registration per project. Reads/writes .apc/mcps.json and
// exposes tool calls through the registry cache.
//   GET    /projects/:pid/mcps
//   POST   /projects/:pid/mcps
//   DELETE /projects/:pid/mcps/:name
//   GET    /projects/:pid/mcps/check
//   POST   /projects/:pid/mcps/:name/call
import fs from "node:fs";
import path from "node:path";
import { readApfMcps, writeApfMcps, SOURCES } from "../../../core/mcp/sources.js";

export function register(app, { projects, registries, project }) {
  app.get("/projects/:pid/mcps", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(registries.for(p).list());
  });

  app.post("/projects/:pid/mcps", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { name, command, args, env, url, headers, enabled } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    if (!command && !url)
      return res.status(400).json({ error: "either command or url required" });

    const json = readApfMcps(p.path);
    json.mcpServers = json.mcpServers || {};
    const existing = json.mcpServers[name] || {};
    json.mcpServers[name] = {
      ...existing,
      ...(command !== undefined ? { command } : {}),
      ...(args !== undefined ? { args } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(headers !== undefined ? { headers } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    };
    writeApfMcps(p.path, json);
    registries.for(p).evict(name);
    projects.rebuild(p.id);
    const entry = registries.for(p).getByName(name);
    res.status(201).json(entry);
  });

  app.delete("/projects/:pid/mcps/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const json = readApfMcps(p.path);
    if (!json.mcpServers || !(req.params.name in (json.mcpServers || {}))) {
      const all = registries.for(p).list();
      const m = all.find((x) => x.name === req.params.name);
      if (m && m.source !== "apc") {
        return res.status(409).json({
          error: `MCP "${req.params.name}" comes from "${m.source}" config — not APC-owned, cannot be removed by apx. Edit ${
            SOURCES.find((s) => s.id === m.source)?.file
          } directly.`,
        });
      }
      return res.status(404).end();
    }
    delete json.mcpServers[req.params.name];
    writeApfMcps(p.path, json);
    registries.for(p).evict(req.params.name);
    projects.rebuild(p.id);
    res.status(204).end();
  });

  app.get("/projects/:pid/mcps/check", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const reg = registries.for(p);
    res.json({
      sources: SOURCES.map((s) => ({
        id: s.id,
        file: s.file,
        present: fs.existsSync(path.join(p.path, s.file)),
      })),
      entries: reg.list().map((m) => ({
        name: m.name,
        source: m.source,
        transport: m.transport,
        enabled: m.enabled,
      })),
      conflicts: reg.conflicts(),
    });
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
}
