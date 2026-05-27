// Global APX config under ~/.apx/config.json. Cross-platform.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const APX_HOME = path.join(os.homedir(), ".apx");
export const CONFIG_PATH = path.join(APX_HOME, "config.json");
export const PID_PATH = path.join(APX_HOME, "daemon.pid");
export const LOG_PATH = path.join(APX_HOME, "daemon.log");
export const TELEGRAM_STATE_PATH = path.join(APX_HOME, "telegram-state.json");
export const TOKEN_PATH = path.join(APX_HOME, "daemon.token");
// Global channel messages (telegram, direct, whatsapp, …) live here,
// separated from any project.  Structure: ~/.apx/messages/<channel>/YYYY-MM-DD.jsonl
export const GLOBAL_MESSAGES_DIR = path.join(APX_HOME, "messages");
// Per-project runtime storage (conversations, sessions) — never in the repo.
// Structure: ~/.apx/projects/<apx_id>/agents/<slug>/conversations/
export const PROJECT_STORE_ROOT = path.join(APX_HOME, "projects");
export const DEFAULT_PROJECT_ID = "default";
export const DEFAULT_PROJECT_STORE = path.join(PROJECT_STORE_ROOT, DEFAULT_PROJECT_ID);

export function projectStorageRoot(apxId) {
  return path.join(PROJECT_STORE_ROOT, apxId);
}

export function ensureProjectStorage(apxId) {
  const root = projectStorageRoot(apxId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

const DEFAULT_CONFIG = {
  port: 7430,
  host: "127.0.0.1",
  log_level: "info",
  projects: [],
  user: {
    language: "en",  // ISO 639-1; super-agent replies, transcription, wake-up
    locale: "",      // optional BCP-47 dialect hint, e.g. es-AR
    timezone: "",    // optional IANA zone, e.g. America/Argentina/Buenos_Aires
  },
  telegram: {
    enabled: false,
    poll_interval_ms: 1500,
    route_to_agent: "",                 // slug of the agent that auto-replies (single-channel mode)
    respond_with_engine: true,          // false → just log, never auto-reply
    channels: [],                       // multi-channel mode; each item: {name, bot_token, chat_id, route_to_agent, project, respond_with_engine}
  },
  super_agent: {
    enabled: false,
    name: "apx",
    model: "",                          // e.g. "ollama:llama3.2:3b"
    system: "",                         // optional override; defaults in src/core/agent/prompts/
    permission_mode: "automatico",       // total | automatico | permiso
    allowed_tools: [],                   // used by permission_mode="permiso"
    // Model fallback: ordered list. Each item carries its own provider
    // prefix; the array order IS the attempt order. The router tries the
    // primary (super_agent.model) first, then walks this list, skipping
    // providers whose health check fails (Ollama strict-checks the model is
    // actually pulled). Old configs with { order:[], models:{} } still work
    // — they're normalised on read.
    model_fallback: {
      enabled: true,
      models: [
        "openrouter:meta-llama/llama-3.3-70b-instruct",
        "groq:llama-3.3-70b-versatile",
      ],
      health_timeout_ms: 800,
    },
  },
  engines: {
    anthropic: { api_key: "" },
    openai: { api_key: "", base_url: "https://api.openai.com/v1" },
    groq: { api_key: "", base_url: "https://api.groq.com/openai/v1" },
    openrouter: { api_key: "", base_url: "https://openrouter.ai/api/v1" },
    gemini: { api_key: "" },
    ollama: { base_url: "http://localhost:11434" },
  },
  voice: {
    // Text-to-speech configuration. Selector reads voice.tts.provider; "auto"
    // probes engines in preference order (piper → elevenlabs → openai →
    // gemini → mock). Per-engine settings live under voice.tts.<engine>.
    tts: {
      provider: "auto",         // "auto" | "piper" | "elevenlabs" | "openai" | "gemini" | "mock"
      piper:      { bin: "piper", model: "", speaker: "", extra_args: [] },
      elevenlabs: { api_key: "", model: "eleven_multilingual_v2", voice_id: "", output_format: "mp3_44100_128" },
      openai:     { api_key: "", model: "tts-1", voice: "alloy", format: "mp3" },
      gemini:     { api_key: "", model: "gemini-2.5-flash-preview-tts", voice: "Kore" },
    },
  },
};

function ensureHome() {
  fs.mkdirSync(APX_HOME, { recursive: true });
}

export function readConfig() {
  ensureHome();
  if (!fs.existsSync(CONFIG_PATH)) {
    writeConfig(DEFAULT_CONFIG);
    return structuredClone(DEFAULT_CONFIG);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    throw new Error(`invalid ${CONFIG_PATH}: ${e.message}`);
  }
  return mergeDefaults(raw);
}

export function writeConfig(cfg) {
  ensureHome();
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
  fs.renameSync(tmp, CONFIG_PATH);
}

// Normalise `model_fallback` to the new format (`models` as an ordered array
// of "<provider>:<model>" strings). Legacy configs that use `order + models{}`
// are converted in place; the result is what the runtime sees, but
// writeConfig() preserves whichever shape the user has on disk unless we
// rewrite it explicitly elsewhere.
function mergeModelFallback(raw) {
  const def = DEFAULT_CONFIG.super_agent.model_fallback;
  const src = raw && typeof raw === "object" ? raw : {};

  // Resolve `models` to an array. Three input shapes:
  //   1. array of strings → keep, filtered to "<provider>:<model>".
  //   2. legacy object + (optional) order → walk order, collect values.
  //   3. nothing → use defaults.
  let models;
  if (Array.isArray(src.models)) {
    models = src.models
      .filter((m) => typeof m === "string" && m.includes(":"))
      .map(String);
  } else if (src.models && typeof src.models === "object") {
    const order = Array.isArray(src.order)
      ? src.order.map(String)
      : ["ollama", "openrouter", "groq"];
    models = [];
    for (const p of order) {
      const m = src.models[p.toLowerCase()];
      if (typeof m === "string" && m.includes(":")) models.push(m);
    }
  } else {
    models = [...def.models];
  }

  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : def.enabled,
    models,
    health_timeout_ms:
      Number.isFinite(src.health_timeout_ms) && src.health_timeout_ms > 0
        ? src.health_timeout_ms
        : def.health_timeout_ms,
  };
}

// Migrate legacy `telegram.bot_token` / `telegram.chat_id` (root level) into
// `telegram.channels[]`. These root-level fields were removed once channels[]
// became the source of truth; we keep this helper around so existing configs
// upgrade in place without losing credentials.
function mergeTelegram(rawTelegram) {
  const src = rawTelegram || {};
  const { bot_token: legacyBotToken, chat_id: legacyChatId, channels: rawChannels, ...rest } = src;
  let channels = Array.isArray(rawChannels) ? rawChannels : [];

  const hasLegacy =
    (typeof legacyBotToken === "string" && legacyBotToken.length > 0) ||
    (typeof legacyChatId === "string" && legacyChatId.length > 0);

  if (hasLegacy && channels.length === 0) {
    // Build a single "default" channel from the legacy fields and drop them.
    channels = [
      {
        name: "default",
        bot_token: legacyBotToken || "",
        chat_id: legacyChatId || "",
      },
    ];
    // eslint-disable-next-line no-console
    console.warn("[apx] migrated legacy telegram.bot_token/chat_id into channels[0]");
  }

  return {
    ...DEFAULT_CONFIG.telegram,
    ...rest,
    channels,
  };
}

export function mergeDefaults(cfg) {
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    user: { ...DEFAULT_CONFIG.user, ...(cfg.user || {}) },
    telegram: mergeTelegram(cfg.telegram),
    super_agent: {
      ...DEFAULT_CONFIG.super_agent,
      ...(cfg.super_agent || {}),
      model_fallback: mergeModelFallback(cfg.super_agent?.model_fallback),
    },
    engines: {
      ...DEFAULT_CONFIG.engines,
      ...(cfg.engines || {}),
      anthropic: { ...DEFAULT_CONFIG.engines.anthropic, ...(cfg.engines?.anthropic || {}) },
      openai:    { ...DEFAULT_CONFIG.engines.openai,    ...(cfg.engines?.openai    || {}) },
      groq:      { ...DEFAULT_CONFIG.engines.groq,      ...(cfg.engines?.groq      || {}) },
      openrouter: { ...DEFAULT_CONFIG.engines.openrouter, ...(cfg.engines?.openrouter || {}) },
      gemini:    { ...DEFAULT_CONFIG.engines.gemini,    ...(cfg.engines?.gemini    || {}) },
      ollama:    { ...DEFAULT_CONFIG.engines.ollama,    ...(cfg.engines?.ollama    || {}) },
    },
    voice: {
      ...DEFAULT_CONFIG.voice,
      ...(cfg.voice || {}),
      tts: {
        ...DEFAULT_CONFIG.voice.tts,
        ...(cfg.voice?.tts || {}),
        piper:      { ...DEFAULT_CONFIG.voice.tts.piper,      ...(cfg.voice?.tts?.piper      || {}) },
        elevenlabs: { ...DEFAULT_CONFIG.voice.tts.elevenlabs, ...(cfg.voice?.tts?.elevenlabs || {}) },
        openai:     { ...DEFAULT_CONFIG.voice.tts.openai,     ...(cfg.voice?.tts?.openai     || {}) },
        gemini:     { ...DEFAULT_CONFIG.voice.tts.gemini,     ...(cfg.voice?.tts?.gemini     || {}) },
      },
    },
    projects: Array.isArray(cfg.projects) ? cfg.projects : [],
  };
}

export function effectivePort(cfg) {
  const env = process.env.APX_PORT;
  if (env && /^\d+$/.test(env)) return parseInt(env, 10);
  return cfg.port || DEFAULT_CONFIG.port;
}

export function effectiveHost(cfg) {
  return process.env.APX_HOST || cfg.host || DEFAULT_CONFIG.host;
}

export function addProject(cfg, projectPath) {
  const abs = path.resolve(projectPath);
  if (!fs.existsSync(path.join(abs, "AGENTS.md"))) {
    throw new Error(`not an APC project: ${abs} (no AGENTS.md)`);
  }
  if (!fs.existsSync(path.join(abs, ".apc", "project.json"))) {
    throw new Error(`not an APC project: ${abs} (no .apc/project.json)`);
  }
  const exists = cfg.projects.find((p) => path.resolve(p.path) === abs);
  if (exists) return { added: false, project: exists };

  const entry = { path: abs };
  cfg.projects.push(entry);
  writeConfig(cfg);
  return { added: true, project: entry };
}

export function removeProject(cfg, idOrPath) {
  const before = cfg.projects.length;
  if (typeof idOrPath === "number" || /^\d+$/.test(String(idOrPath))) {
    const idx = parseInt(idOrPath, 10) - 1;
    if (idx >= 0 && idx < cfg.projects.length) cfg.projects.splice(idx, 1);
  } else {
    const abs = path.resolve(String(idOrPath));
    cfg.projects = cfg.projects.filter((p) => path.resolve(p.path) !== abs);
  }
  if (cfg.projects.length !== before) writeConfig(cfg);
  return { removed: before - cfg.projects.length };
}
// ── Telegram channels (multi-channel mode) ──────────────────────────────────
// Each entry in cfg.telegram.channels[] is { name, bot_token, chat_id,
// route_to_agent, project, respond_with_engine, poll_interval_ms }.
// These helpers keep the array shape stable for the CLI and the daemon API.

const CHANNEL_FIELDS = [
  "name",
  "bot_token",
  "chat_id",
  "route_to_agent",
  "project",
  "respond_with_engine",
  "poll_interval_ms",
];

function ensureChannelsArray(cfg) {
  cfg.telegram = cfg.telegram || {};
  if (!Array.isArray(cfg.telegram.channels)) cfg.telegram.channels = [];
  return cfg.telegram.channels;
}

export function listTelegramChannels(cfg) {
  return ensureChannelsArray(cfg).slice();
}

export function findTelegramChannel(cfg, name) {
  return ensureChannelsArray(cfg).find((c) => c.name === name) || null;
}

// Create-or-patch a channel by name. `patch` is a partial channel object;
// unknown keys are dropped. Returns { created, channel }.
export function upsertTelegramChannel(cfg, name, patch = {}) {
  if (!name || typeof name !== "string")
    throw new Error("upsertTelegramChannel: name required");
  const channels = ensureChannelsArray(cfg);
  let entry = channels.find((c) => c.name === name);
  const created = !entry;
  if (!entry) {
    entry = { name };
    channels.push(entry);
  }
  for (const k of CHANNEL_FIELDS) {
    if (k === "name") continue;
    if (patch[k] !== undefined) entry[k] = patch[k];
  }
  // Default respond_with_engine to true on create.
  if (created && entry.respond_with_engine === undefined) {
    entry.respond_with_engine = true;
  }
  writeConfig(cfg);
  return { created, channel: entry };
}

export function removeTelegramChannel(cfg, name) {
  const channels = ensureChannelsArray(cfg);
  const before = channels.length;
  cfg.telegram.channels = channels.filter((c) => c.name !== name);
  const removed = before - cfg.telegram.channels.length;
  if (removed > 0) writeConfig(cfg);
  return { removed };
}

// Clear specific optional fields on a channel (project, route_to_agent, …).
// Returns { channel } or null when no such channel.
export function unsetTelegramChannelFields(cfg, name, fields = []) {
  const ch = findTelegramChannel(cfg, name);
  if (!ch) return null;
  let mutated = false;
  for (const f of fields) {
    if (!CHANNEL_FIELDS.includes(f) || f === "name") continue;
    if (f in ch) {
      delete ch[f];
      mutated = true;
    }
  }
  if (mutated) writeConfig(cfg);
  return { channel: ch };
}

