// Global APX config under ~/.apx/config.json. Cross-platform.
//
// Filesystem paths live in ./paths.js and are re-exported from here so callers
// can keep `import { APX_HOME, projectStorageRoot } from ".../config"` working.
import fs from "node:fs";
import path from "node:path";
import { APX_HOME, CONFIG_PATH } from "./paths.js";
import { PERMISSION_MODES, DEFAULT_PERMISSION_MODE } from "../constants/permissions.js";
import { agentsMdFile, apcProjectFile } from "../apc/paths.js";

export {
  APX_HOME,
  CONFIG_PATH,
  PID_PATH,
  LOG_PATH,
  TELEGRAM_STATE_PATH,
  TOKEN_PATH,
  GLOBAL_MESSAGES_DIR,
  PROJECT_STORE_ROOT,
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_STORE,
  projectStorageRoot,
  ensureProjectStorage,
} from "./paths.js";

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
    channels: [],                       // multi-channel mode; each item: {name, bot_token, chat_id, route_to_agent, project, respond_with_engine, owner_user_id}
    // Global roster keyed by Telegram user_id (msg.from.id). Identity of a
    // person is the same across every channel/chat; the per-channel
    // owner_user_id only marks who is the owner *of that channel*.
    contacts: [],                       // each: {user_id, name, username, role, note, first_seen, last_seen}
    // role → capabilities. "owner" is implicit (full); "guest" is the default
    // for unknown senders (no permissions). Custom roles can be added here.
    roles: {
      owner: { tools: "*" },
      guest: { tools: [] },
    },
  },
  super_agent: {
    enabled: false,
    name: "apx",
    model: "",                          // e.g. "ollama:llama3.2:3b"
    system: "",                         // optional override; defaults in src/core/agent/prompts/
    permission_mode: PERMISSION_MODES.AUTOMATICO,       // total | automatico | permiso
    allowed_tools: [],                   // used by permission_mode="permiso"
    // Per-turn tool-loop budget for the Telegram super-agent. Higher = more
    // autonomous (chains explore→edit→verify→close before replying); lower =
    // snappier but more "want me to continue?" hand-backs. 0/unset → built-in
    // default (TELEGRAM_TOOL_ITERS in src/core/agent/constants.js).
    telegram_max_iters: 0,
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
  memory: {
    // Cross-channel memory subsystem (RAG + progressive compaction + broker).
    enabled: true,
    // Embeddings provider for the RAG retriever. Selector reads
    // memory.embeddings.provider; "auto" probes engines in preference order
    // (ollama → gemini → openai → tf). Per-engine settings live under
    // memory.embeddings.<engine>. Mirrors voice.tts. Switching provider changes
    // the embedder space — re-index (clear memory.db) to backfill old messages.
    embeddings: {
      provider: "auto",          // "auto" | "ollama" | "openai" | "gemini" | "tf"
      mode: "chain",             // "chain" (fallback router) | "single" (only the default)
      order: ["ollama", "gemini", "openai", "tf"],
      ollama: { model: "nomic-embed-text", base_url: "", timeout_ms: 4000 },
      openai: { api_key: "", model: "text-embedding-3-small", base_url: "" },
      gemini: { api_key: "", model: "text-embedding-004" },
    },
    // "Active threads" awareness: a tiny block listing recent activity on OTHER
    // channels (pure recency, no semantic match) so a vague "seguimos?" on one
    // surface can pick up a warm thread from another. Bounded + cheap; only
    // appears when there's cross-channel activity in the window.
    active_threads: {
      enabled: true,
      window_hours: 6,   // only surface channels touched within this window
      max_lines: 3,      // hard cap on bullets (token guard)
    },
    // Legacy flat keys (still honored as an ollama override for old configs).
    embed_model: "nomic-embed-text",  // Ollama embeddings model
    embed_base_url: "",               // "" → falls back to engines.ollama.base_url
    embed_timeout_ms: 4000,
    index_interval_s: 60,             // incremental RAG index cadence
    rag_top_k: 5,                     // chunks retrieved per turn
    broker_budget_ms: 800,            // hard cap on the Memory Broker
    compact_threshold: 60,            // compact once a chat exceeds this many turns
    keep_recent: 40,                  // verbatim turns always kept after compaction
    compact_model: "ollama:gemma4:31b-cloud", // light LLM for compaction (Ollama, local endpoint)
    compact_fallback_model: "",        // "" → falls back to super_agent.model (APX default)
  },
  skills: {
    // Skill Inspector — opt-in test feature. When enabled, the static
    // "Available skills" hint block (slug dump) is removed from the system
    // prompt; instead a local RAG inspects each turn's user prompt and
    // injects either the matching skill's body (high confidence) or a hint
    // to call load_skill (mid confidence). Below threshold → nothing.
    // Re-evaluated every turn → natural decay (a skill that stopped matching
    // disappears next turn).
    // Embedding provider is whatever memory.embeddings resolves to (defaults
    // to local: ollama → gemini → openai → offline TF). No paid keys needed.
    inspector: {
      enabled: false,
      load_threshold: 0.55,
      hint_threshold: 0.40,
      margin: 0.04,
      max_loaded: 1,
      max_hints: 2,
      prompt_floor: 8,
      body_char_cap: 6000,
    },
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

// Fields whose values we treat as "credentials" — refuse to silently clobber.
// If a writer hands us cfg that drops a previously-non-empty key here, we
// write a sibling backup and emit a console warning. The write still
// proceeds (so explicit "user wants to clear" still works) but never silent.
// See spec/backlog/14-config-api-keys-reset.md.
const CREDENTIAL_PATHS = [
  ["engines", "anthropic", "api_key"],
  ["engines", "openai", "api_key"],
  ["engines", "groq", "api_key"],
  ["engines", "openrouter", "api_key"],
  ["engines", "gemini", "api_key"],
  ["voice", "tts", "elevenlabs", "api_key"],
  ["voice", "tts", "openai", "api_key"],
  ["voice", "tts", "gemini", "api_key"],
  ["transcription", "openai", "api_key"],
  ["transcription", "custom", "api_key"],
  ["memory", "embeddings", "openai", "api_key"],
  ["memory", "embeddings", "gemini", "api_key"],
  ["telegram", "channels"], // entire array — losing it is also a regression
];

function getDeep(obj, parts) {
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function isMeaningful(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function backupConfigBeforeLoss() {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${CONFIG_PATH}.${ts}.bak`;
    fs.copyFileSync(CONFIG_PATH, backup);
    return backup;
  } catch {
    return null;
  }
}

export function writeConfig(cfg) {
  ensureHome();

  // Guard: refuse to silently clear credentials. The most common cause of
  // wiped keys is a partial writeConfig() from a caller that forgot to
  // re-read the on-disk state. We compare the incoming cfg against what's
  // currently persisted and shout if a credential transitioned non-empty →
  // empty without the caller setting `_allowClear: true` (escape hatch for
  // an explicit reset).
  if (!cfg?._allowClear && fs.existsSync(CONFIG_PATH)) {
    let prior;
    try {
      prior = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch {
      prior = null;
    }
    if (prior) {
      const lost = [];
      for (const parts of CREDENTIAL_PATHS) {
        const before = getDeep(prior, parts);
        const after  = getDeep(cfg, parts);
        if (isMeaningful(before) && !isMeaningful(after)) {
          lost.push(parts.join("."));
        }
      }
      if (lost.length > 0) {
        const backup = backupConfigBeforeLoss();
        // eslint-disable-next-line no-console
        console.warn(
          `[apx] writeConfig: refusing to clear credentials silently — ${lost.join(", ")} would be wiped.\n` +
          `      Backup written to ${backup || "(could not create)"}.\n` +
          `      Pass cfg._allowClear=true if this was intentional.`
        );
        // Patch the incoming cfg in-place: restore the lost values from disk
        // so the caller's other intended changes still go through.
        for (const parts of CREDENTIAL_PATHS) {
          const before = getDeep(prior, parts);
          const after  = getDeep(cfg, parts);
          if (isMeaningful(before) && !isMeaningful(after)) {
            // Mutate cfg to put the value back at parts.
            let cur = cfg;
            for (let i = 0; i < parts.length - 1; i++) {
              const key = parts[i];
              if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
              cur = cur[key];
            }
            cur[parts[parts.length - 1]] = before;
          }
        }
      }
    }
  }
  // Strip the marker before persisting.
  if (cfg?._allowClear) delete cfg._allowClear;

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
    contacts: Array.isArray(src.contacts) ? src.contacts : [],
    roles: { ...DEFAULT_CONFIG.telegram.roles, ...(src.roles || {}) },
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
    memory: {
      ...DEFAULT_CONFIG.memory,
      ...(cfg.memory || {}),
      embeddings: {
        ...DEFAULT_CONFIG.memory.embeddings,
        ...(cfg.memory?.embeddings || {}),
        ollama: { ...DEFAULT_CONFIG.memory.embeddings.ollama, ...(cfg.memory?.embeddings?.ollama || {}) },
        openai: { ...DEFAULT_CONFIG.memory.embeddings.openai, ...(cfg.memory?.embeddings?.openai || {}) },
        gemini: { ...DEFAULT_CONFIG.memory.embeddings.gemini, ...(cfg.memory?.embeddings?.gemini || {}) },
      },
      active_threads: {
        ...DEFAULT_CONFIG.memory.active_threads,
        ...(cfg.memory?.active_threads || {}),
      },
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
  if (!fs.existsSync(agentsMdFile(abs))) {
    throw new Error(`not an APC project: ${abs} (no AGENTS.md)`);
  }
  if (!fs.existsSync(apcProjectFile(abs))) {
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
  "owner_user_id",
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
  if (removed > 0) {
    // Explicit user-initiated removal — bypass the credential-loss guard
    // so the write goes through even when this empties the array.
    cfg._allowClear = true;
    writeConfig(cfg);
  }
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

// ── Telegram contacts (global roster, keyed by user_id) ─────────────────────
// Identity of a person is global; the per-channel owner_user_id only marks who
// owns a given channel. Role lives on the contact (global), per the chosen
// design — owner_user_id overrides it to "owner" for that channel only.

const CONTACT_FIELDS = [
  "user_id",
  "name",
  "username",
  "role",
  "note",
  "first_seen",
  "last_seen",
];

function ensureContactsArray(cfg) {
  cfg.telegram = cfg.telegram || {};
  if (!Array.isArray(cfg.telegram.contacts)) cfg.telegram.contacts = [];
  return cfg.telegram.contacts;
}

export function listContacts(cfg) {
  return ensureContactsArray(cfg).slice();
}

export function findContact(cfg, userId) {
  if (userId == null) return null;
  return (
    ensureContactsArray(cfg).find((c) => String(c.user_id) === String(userId)) ||
    null
  );
}

// Create-or-patch a contact by user_id. Unknown keys are dropped.
export function upsertContact(cfg, userId, patch = {}, { persist = true } = {}) {
  if (userId == null) throw new Error("upsertContact: user_id required");
  const contacts = ensureContactsArray(cfg);
  let entry = contacts.find((c) => String(c.user_id) === String(userId));
  const created = !entry;
  if (!entry) {
    entry = { user_id: userId };
    contacts.push(entry);
  }
  for (const k of CONTACT_FIELDS) {
    if (k === "user_id") continue;
    if (patch[k] !== undefined) entry[k] = patch[k];
  }
  if (persist) writeConfig(cfg);
  return { created, contact: entry };
}

export function setContactRole(cfg, userId, role) {
  const { contact } = upsertContact(cfg, userId, { role });
  return contact;
}

export function removeContact(cfg, userId) {
  const contacts = ensureContactsArray(cfg);
  const before = contacts.length;
  cfg.telegram.contacts = contacts.filter(
    (c) => String(c.user_id) !== String(userId)
  );
  const removed = before - cfg.telegram.contacts.length;
  if (removed > 0) writeConfig(cfg);
  return { removed };
}

export function setChannelOwner(cfg, channelName, userId) {
  return upsertTelegramChannel(cfg, channelName, { owner_user_id: userId });
}

// ── Telegram roles (role → capability map) ──────────────────────────────────

export function listRoles(cfg) {
  cfg.telegram = cfg.telegram || {};
  return { ...(cfg.telegram.roles || {}) };
}

export function setRole(cfg, name, def) {
  if (!name || typeof name !== "string") throw new Error("setRole: name required");
  cfg.telegram = cfg.telegram || {};
  cfg.telegram.roles = cfg.telegram.roles || {};
  cfg.telegram.roles[name] = def;
  writeConfig(cfg);
  return cfg.telegram.roles[name];
}

export function removeRole(cfg, name) {
  cfg.telegram = cfg.telegram || {};
  if (!cfg.telegram.roles || !(name in cfg.telegram.roles)) return { removed: 0 };
  if (name === "owner" || name === "guest") {
    throw new Error(`role "${name}" is built-in and cannot be removed`);
  }
  delete cfg.telegram.roles[name];
  writeConfig(cfg);
  return { removed: 1 };
}

