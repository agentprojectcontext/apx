// Curated engine catalog — the SINGLE SOURCE OF TRUTH for the known models,
// per-engine defaults, base URLs and api-key env vars shown across APX.
//
// Who consumes this:
//   • CLI  — `apx setup` builds its provider/model menus from here
//     (src/interfaces/cli/commands/setup.js).
//   • Web  — the admin panel fetches it via `GET /api/engines/presets` and hydrates
//     its provider forms (src/interfaces/web/.../providers/typeStyles.ts).
//
// This is the OFFLINE / no-key fallback list. When the user has an api_key
// configured, the daemon's `POST /api/engines/models` returns the provider's LIVE
// catalog instead (see ./catalog.js). The model field is ALWAYS free-text, so
// any id can be typed even if it is not listed here.
//
// `ollama` and `custom` are intentionally dynamic — no curated model list.
// Update model ids in THIS file only; every surface reflects the change.

// Engines that answer with no api_key of their own. This is a CONFIGURATION
// fact, not a health one: a surface deciding whether a provider is even
// selectable has to tell "you never gave me a key" apart from "the key is
// there and the call failed". Zen ships a built-in default key ("public"),
// Ollama and mock need none at all — so none of them is ever "unconfigured".
/** @typedef {{ base_url: string, default_model: string, api_key_env: string, known_models: string[], key_optional?: boolean, locked?: boolean }} EnginePreset */

/** @type {Record<string, EnginePreset>} */
export const ENGINE_PRESETS = {
  anthropic: {
    base_url: "", // empty ⇒ adapter uses the built-in Anthropic endpoint
    default_model: "claude-sonnet-5",
    api_key_env: "ANTHROPIC_API_KEY",
    known_models: [
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
    ],
  },
  openai: {
    base_url: "https://api.openai.com/v1",
    default_model: "gpt-5.6-luna",
    api_key_env: "OPENAI_API_KEY",
    known_models: [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
    ],
  },
  gemini: {
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    default_model: "gemini-3.7-flash",
    api_key_env: "GEMINI_API_KEY",
    known_models: [
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ],
  },
  groq: {
    base_url: "https://api.groq.com/openai/v1",
    default_model: "openai/gpt-oss-20b",
    api_key_env: "GROQ_API_KEY",
    known_models: [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.6-27b",
      "groq/compound",
      "groq/compound-mini",
      "whisper-large-v3-turbo",
    ],
  },
  cerebras: {
    base_url: "https://api.cerebras.ai/v1",
    default_model: "qwen-3.8-27b",
    api_key_env: "CEREBRAS_API_KEY",
    // Verified against GET /v1/models — the ids differ from the vendor's docs.
    known_models: ["qwen-3.8-27b", "gpt-oss-120b", "gemma-4-31b"],
  },
  openrouter: {
    base_url: "https://openrouter.ai/api/v1",
    // openrouter/auto = "Auto Router": OpenRouter picks the best model.
    default_model: "openrouter/auto",
    api_key_env: "OPENROUTER_API_KEY",
    known_models: [
      "openrouter/auto",
      "openrouter/free",
      "anthropic/claude-opus-5",
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "google/gemini-3.7-flash",
      "qwen/qwen3.8-27b",
    ],
  },
  azure: {
    base_url: "",
    default_model: "", // Azure deployment names are user-defined
    api_key_env: "AZURE_OPENAI_API_KEY",
    known_models: [],
  },
  ollama: {
    key_optional: true,
    base_url: "http://127.0.0.1:11434",
    default_model: "gemma2:9b",
    api_key_env: "",
    known_models: [], // dynamic — fetched live from the local Ollama daemon
  },
  // OpenCode Zen. The free ids come first: they bill at zero and accept the
  // literal api_key "public". What they also need is the request shape the
  // gate checks for — see src/core/engines/zen.js, which builds it. The paid
  // Claude/GPT/Gemini models on the same base URL need a real Zen key.
  //
  // Verified answering on 2026-09-18. Four more ids the catalog advertises are
  // NOT here on purpose: deepseek-v4-flash-free 400s ("Model is unavailable"),
  // both muse-spark-*-contributor-free 500, and laguna-s-2.1-free / hy3-free
  // no longer exist.
  zen: {
    key_optional: true,
    base_url: "https://opencode.ai/zen/v1",
    default_model: "big-pickle",
    api_key_env: "OPENCODE_ZEN_API_KEY",
    known_models: [
      "big-pickle",
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "mimo-v2.5-free",
      "ling-3.0-flash-fin-free",
      "claude-haiku-4-5",
      "claude-sonnet-4-5",
      "gemini-3.5-flash",
      "gpt-5-nano",
    ],
  },
  // ChatGPT / Codex Plus via APX OAuth (~/.apx/auth/chatgpt-codex.json).
  // Billing hits the plan; APX owns the agent loop (Telegram, tools, stream).
  "codex-plus": {
    key_optional: true,
    locked: true,
    base_url: "https://chatgpt.com/backend-api/codex",
    default_model: "gpt-5.6-luna",
    api_key_env: "",
    known_models: [
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.5",
      "gpt-6-astra",
    ],
    // Reasoning effort is a SETTING of a model, not another model: stored as
    // an `@<effort>` suffix on the id (`gpt-5.6-luna@high`) so every place
    // that holds one model string holds it too, and shown by the panel as a
    // separate control. codex-plus.js reads the same list.
    efforts: ["minimal", "low", "medium", "high", "xhigh"],
  },
  // Claude Max (+ extra usage credits) via APX PKCE OAuth.
  "claude-subscription": {
    key_optional: true,
    locked: true,
    base_url: "https://api.anthropic.com",
    default_model: "claude-sonnet-4-5",
    api_key_env: "",
    known_models: [
      "claude-opus-4-6",
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
    ],
  },
  mock: { base_url: "", default_model: "mock", api_key_env: "", known_models: ["mock"], key_optional: true },
  custom: { base_url: "", default_model: "", api_key_env: "", known_models: [] },
};

/** Known models for one engine, or [] if the engine is dynamic/unknown. */
export function knownModels(engine) {
  return ENGINE_PRESETS[engine]?.known_models ?? [];
}

/**
 * Built-in / plan engines that must stay in config (UI shows a lock, PATCH
 * refuses to unset them). A provider row is locked when its own `locked`
 * flag is set, or when its adapter preset marks `locked: true`.
 */
export function isLockedProvider(slug, enginesCfg = {}) {
  if (slug === "chatgpt-codex" || slug === "especial" || slug === "claude-subscription") return true;
  const row = (enginesCfg && enginesCfg[slug]) || {};
  if (row.locked === true) return true;
  const engineId = row.engine || slug;
  return ENGINE_PRESETS[engineId]?.locked === true;
}
