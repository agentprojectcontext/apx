// POST /admin/reload     — re-read ~/.apx/config.json into the live config
//                          object and propagate to scheduler/plugins.
// POST /admin/shutdown    — clean exit (50 ms grace so the response flushes).
//
// Both are auth-gated (the global middleware applies).
import { readConfig } from "../../../core/config.js";

export function register(app, { scheduler, plugins, config }) {
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
}
