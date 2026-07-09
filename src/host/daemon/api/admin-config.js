// GET   /admin/config             redacted view of ~/.apx/config.json
// PATCH /admin/config             { set?: { "a.b.c": value }, unset?: ["a.b"] }
//                                  applies + writes the file + reloads in-memory
//
// The PATCH variant is intentional: PUT would force the caller to send the
// whole credentials block, and a UI that forgot one field would wipe secrets.
// Dotted keys make every edit narrowly-scoped.
import { readConfig, writeConfig } from "#core/config/index.js";
import { resolveAgentName } from "#core/identity/index.js";
import { setDottedKey, unsetDottedKey } from "../project-config.js";
import { PERMISSION_MODES, DEFAULT_PERMISSION_MODE } from "#core/constants/permissions.js";
import {
  redactConfig as redact,
  isSecretMarker,
  mergeRedactedChannels,
} from "#core/config/redact.js";
import { collectSecretValues, registerSecretValues } from "#core/config/secret-values.js";

export function register(app, { config, scheduler, plugins }) {
  app.get("/admin/config", (_req, res) => {
    try {
      const fresh = readConfig();
      res.json({ config: redact(fresh) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/admin/config", (req, res) => {
    const { set, unset } = req.body || {};
    let cfg;
    try {
      cfg = readConfig();
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    if (set && typeof set === "object") {
      for (const [k, v] of Object.entries(set)) {
        if (isSecretMarker(v)) continue;
        if (k === "telegram.channels") {
          setDottedKey(cfg, k, mergeRedactedChannels(v, cfg.telegram?.channels));
          continue;
        }
        // A literal empty string means "clear this secret" — passthrough.
        // null also clears.
        setDottedKey(cfg, k, v);
      }
    }
    if (Array.isArray(unset)) {
      for (const k of unset) unsetDottedKey(cfg, k);
    }
    try {
      writeConfig(cfg);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    // Hot-reload in-memory config so subsequent calls see the change.
    const fresh = readConfig();
    for (const key of Object.keys(config)) delete config[key];
    Object.assign(config, fresh);
    // Keep the log-masking registry current: any secret just added via PATCH
    // must be masked from this point on (registry is additive — removed
    // secrets stay masked, which is the safe direction).
    registerSecretValues(collectSecretValues(fresh));
    if (scheduler) scheduler.globalConfig = config;
    if (plugins) plugins.config = config;
    res.json({ ok: true, config: redact(fresh) });
  });

  // Convenience: GET the resolved super_agent prompt (used by SettingsScreen)
  app.get("/admin/super-agent", (_req, res) => {
    try {
      const fresh = readConfig();
      const sa = fresh.super_agent || {};
      res.json({
        enabled: !!sa.enabled,
        name: resolveAgentName(fresh),
        model: sa.model || "",
        system: sa.system || "",
        permission_mode: sa.permission_mode || PERMISSION_MODES.PERMISO,
        allowed_tools: sa.allowed_tools || [],
        model_fallback: sa.model_fallback || { enabled: false, models: [], order: [] },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
