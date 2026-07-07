// Curated engine catalog — the SINGLE SOURCE OF TRUTH for the known models,
// per-engine defaults, base URLs and api-key env vars shown across APX.
//
// Who consumes this:
//   • CLI  — `apx setup` builds its provider/model menus from here
//     (src/interfaces/cli/commands/setup.js).
//   • Web  — the admin panel fetches it via `GET /engines/presets` and hydrates
//     its provider forms (src/interfaces/web/.../providers/typeStyles.ts).
//
// This is the OFFLINE / no-key fallback list. When the user has an api_key
// configured, the daemon's `POST /engines/models` returns the provider's LIVE
// catalog instead (see ./catalog.js). The model field is ALWAYS free-text, so
// any id can be typed even if it is not listed here.
//
// `ollama` and `custom` are intentionally dynamic — no curated model list.
// Update model ids in THIS file only; every surface reflects the change.

/** @typedef {{ base_url: string, default_model: string, api_key_env: string, known_models: string[] }} EnginePreset */

/** @type {Record<string, EnginePreset>} */
export const ENGINE_PRESETS = {
  anthropic: {
    base_url: "", // empty ⇒ adapter uses the built-in Anthropic endpoint
    default_model: "claude-sonnet-5",
    api_key_env: "ANTHROPIC_API_KEY",
    known_models: [
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-fable-5",
    ],
  },
  openai: {
    base_url: "https://api.openai.com/v1",
    default_model: "gpt-5.4-mini",
    api_key_env: "OPENAI_API_KEY",
    known_models: [
      "gpt-5.5",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.1",
      "gpt-4.1-mini",
    ],
  },
  gemini: {
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    default_model: "gemini-2.5-flash",
    api_key_env: "GEMINI_API_KEY",
    known_models: [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
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
  openrouter: {
    base_url: "https://openrouter.ai/api/v1",
    // openrouter/auto = "Auto Router": OpenRouter picks the best model.
    default_model: "openrouter/auto",
    api_key_env: "OPENROUTER_API_KEY",
    known_models: [
      "openrouter/auto",
      "openrouter/free",
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.4-mini",
      "google/gemini-2.5-flash",
    ],
  },
  azure: {
    base_url: "",
    default_model: "", // Azure deployment names are user-defined
    api_key_env: "AZURE_OPENAI_API_KEY",
    known_models: [],
  },
  ollama: {
    base_url: "http://127.0.0.1:11434",
    default_model: "gemma2:9b",
    api_key_env: "",
    known_models: [], // dynamic — fetched live from the local Ollama daemon
  },
  mock: { base_url: "", default_model: "mock", api_key_env: "", known_models: ["mock"] },
  custom: { base_url: "", default_model: "", api_key_env: "", known_models: [] },
};

/** Known models for one engine, or [] if the engine is dynamic/unknown. */
export function knownModels(engine) {
  return ENGINE_PRESETS[engine]?.known_models ?? [];
}
