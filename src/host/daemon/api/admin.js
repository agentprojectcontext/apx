// POST /admin/reload     — re-read ~/.apx/config.json into the live config
//                          object and propagate to scheduler/plugins.
// POST /admin/shutdown    — clean exit (50 ms grace so the response flushes).
//
// Both are auth-gated (the global middleware applies).
import { readConfig } from "#core/config/index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function register(app, { scheduler, plugins, config }) {
  // Daemon logs: errors.jsonl (structured) or apx.log (plain), newest first.
  app.get("/admin/logs", (req, res) => {
    const dir = path.join(os.homedir(), ".apx", "logs");
    const which = req.query.file === "apx" ? "apx.log" : "errors.jsonl";
    const file = path.join(dir, which);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 2000);
    if (!fs.existsSync(file)) return res.json({ file: which, entries: [], lines: [] });
    const all = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const tail = all.slice(-limit).reverse();
    if (which === "errors.jsonl") {
      const entries = tail.map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      return res.json({ file: which, entries });
    }
    res.json({ file: which, lines: tail });
  });

  app.post("/admin/reload", (_req, res) => {
    try {
      const fresh = readConfig();
      // Mutate in place so every closure that captured `config` sees the new
      // values (super-agent, model router, telegram, …).
      for (const key of Object.keys(config)) delete config[key];
      Object.assign(config, fresh);
      if (scheduler) scheduler.globalConfig = config;
      if (plugins) plugins.config = config;
      res.json({
        ok: true,
        super_agent_model: config.super_agent?.model || null,
        fallback_order: config.super_agent?.model_fallback?.order || [],
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/admin/shutdown", (_req, res) => {
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 50);
  });

  app.get("/admin/fs/dirs", (req, res) => {
    const requested = String(req.query.path || os.homedir());
    const base = path.resolve(requested.replace(/^~(?=$|\/)/, os.homedir()));
    try {
      const stat = fs.statSync(base);
      const dir = stat.isDirectory() ? base : path.dirname(base);
      const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => path.join(dir, entry.name))
        .sort((a, b) => a.localeCompare(b));
      res.json({
        path: dir,
        parent: path.dirname(dir) === dir ? null : path.dirname(dir),
        entries,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
