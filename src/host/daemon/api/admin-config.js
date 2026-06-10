// GET   /admin/config             redacted view of ~/.apx/config.json
// PATCH /admin/config             { set?: { "a.b.c": value }, unset?: ["a.b"] }
//                                  applies + writes the file + reloads in-memory
//
// The PATCH variant is intentional: PUT would force the caller to send the
// whole credentials block, and a UI that forgot one field would wipe secrets.
// Dotted keys make every edit narrowly-scoped.
import { readConfig, writeConfig } from "../../../core/config/index.js";
import { resolveAgentName } from "../../../core/identity/index.js";
import { setDottedKey, unsetDottedKey } from "../project-config.js";

const SECRET_PATHS = [
  "engines.anthropic.api_key",
  "engines.openai.api_key",
  "engines.groq.api_key",
  "engines.openrouter.api_key",
  "engines.gemini.api_key",
  "voice.tts.elevenlabs.api_key",
  "voice.tts.openai.api_key",
  "voice.tts.gemini.api_key",
  "memory.embeddings.openai.api_key",
  "memory.embeddings.gemini.api_key",
  "telegram.channels.*.bot_token",
];

function getDotted(obj, dotted) {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function secretMarker(value) {
  if (typeof value !== "string" || !value.length) return value;
  const suffix = value.slice(-5);
  return `*** set *** (...${suffix})`;
}

function isSecretMarker(value) {
  return typeof value === "string" && value.startsWith("*** set ***");
}

// Returns a deep copy with `*** set ***` for every present secret value.
function redact(cfg) {
  const out = JSON.parse(JSON.stringify(cfg || {}));
  const mark = (val) => (typeof val === "string" && val.length ? secretMarker(val) : val);

  // Engine api keys + voice tts keys
  for (const path of SECRET_PATHS) {
    if (path.includes("*")) continue;
    const parts = path.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") { cur = null; break; }
      cur = cur[parts[i]];
    }
    if (cur && cur[parts[parts.length - 1]]) {
      cur[parts[parts.length - 1]] = mark(cur[parts[parts.length - 1]]);
    }
  }
  // Telegram channels — array, redact bot_token per item (keep the suffix so
  // the UI can show which token is set, e.g. "*** set *** (...AB12)").
  const channels = out?.telegram?.channels;
  if (Array.isArray(channels)) {
    for (const ch of channels) {
      if (ch && typeof ch.bot_token === "string" && ch.bot_token.length) {
        ch.bot_token = mark(ch.bot_token);
      }
    }
  }
  return out;
}

function mergeRedactedChannels(nextChannels, priorChannels) {
  if (!Array.isArray(nextChannels)) return nextChannels;
  const priorByName = new Map(
    (Array.isArray(priorChannels) ? priorChannels : [])
      .filter((c) => c && typeof c.name === "string")
      .map((c) => [c.name, c])
  );
  return nextChannels.map((channel) => {
    if (!channel || typeof channel !== "object") return channel;
    const prior = priorByName.get(channel.name);
    if (prior?.bot_token && (channel.bot_token === undefined || isSecretMarker(channel.bot_token))) {
      return { ...channel, bot_token: prior.bot_token };
    }
    return channel;
  });
}

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
        permission_mode: sa.permission_mode || "permiso",
        allowed_tools: sa.allowed_tools || [],
        model_fallback: sa.model_fallback || { enabled: false, models: [], order: [] },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
