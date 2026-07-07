// Visual styles per provider engine (adapter). Maps the engine id to a
// gradient (card icon) and a badge class. Ported/adapted from pandaproject.

export type EngineType =
  | "anthropic" | "openai" | "gemini" | "groq"
  | "openrouter" | "ollama" | "azure" | "mock" | "custom";

export const ENGINE_GRADIENTS: Record<EngineType, string> = {
  anthropic:  "from-orange-600 to-amber-600",
  openai:     "from-emerald-600 to-teal-600",
  gemini:     "from-blue-600 to-indigo-600",
  groq:       "from-cyan-600 to-teal-600",
  openrouter: "from-violet-600 to-indigo-600",
  ollama:     "from-amber-600 to-orange-600",
  azure:      "from-blue-600 to-cyan-600",
  mock:       "from-slate-600 to-gray-600",
  custom:     "from-slate-600 to-gray-600",
};

export const ENGINE_BADGES: Record<EngineType, string> = {
  anthropic:  "bg-orange-500/20 text-orange-300 border border-orange-500/40",
  openai:     "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  gemini:     "bg-blue-500/20 text-blue-300 border border-blue-500/40",
  groq:       "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40",
  openrouter: "bg-violet-500/20 text-violet-300 border border-violet-500/40",
  ollama:     "bg-amber-500/20 text-amber-300 border border-amber-500/40",
  azure:      "bg-blue-500/20 text-blue-300 border border-blue-500/40",
  mock:       "bg-slate-500/20 text-slate-300 border border-slate-500/40",
  custom:     "bg-slate-500/20 text-slate-300 border border-slate-500/40",
};

export const ENGINE_OPTIONS: { value: EngineType; label: string }[] = [
  { value: "anthropic",  label: "Anthropic" },
  { value: "openai",     label: "OpenAI-compatible" },
  { value: "gemini",     label: "Gemini" },
  { value: "groq",       label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "ollama",     label: "Ollama" },
  { value: "azure",      label: "Azure OpenAI" },
  { value: "mock",       label: "Mock (test)" },
  { value: "custom",     label: "Custom" },
];

export function engineStyle<T>(map: Record<EngineType, T>, value: string | null | undefined): T {
  if (value && value in map) return map[value as EngineType];
  return map.custom;
}

// Icon per engine (lucide name). Used in provider cards + selects.
import { Sparkles, Bot, Gem, Zap, GitBranch, Server, Cloud, FlaskConical, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const ENGINE_ICONS: Record<EngineType, LucideIcon> = {
  anthropic:  Sparkles,
  openai:     Bot,
  gemini:     Gem,
  groq:       Zap,
  openrouter: GitBranch,
  ollama:     Server,
  azure:      Cloud,
  mock:       FlaskConical,
  custom:     Wrench,
};

// Sensible defaults per engine so the form auto-fills base_url, suggests
// models, and hints the api-key env var. base_url "" = adapter has a built-in
// default (e.g. Anthropic SDK).
//
// NOTE: the values below are only an OFFLINE FALLBACK. The source of truth is
// src/core/engines/presets.js, served by `GET /engines/presets`. Call
// `loadEnginePresets()` once at app boot to hydrate this object in place so the
// model lists stay in sync with the CLI wizard and never drift.
export interface EnginePreset {
  base_url: string;
  default_model: string;
  api_key_env: string;
  known_models: string[];
}

export const ENGINE_PRESETS: Record<EngineType, EnginePreset> = {
  // Keep these in sync with src/core/engines/presets.js. They are the offline
  // fallback only — loadEnginePresets() overrides them from the daemon at boot.
  anthropic: {
    base_url: "",
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
    known_models: ["gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.1", "gpt-4.1-mini"],
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
    // openrouter/auto = "Auto Router": OpenRouter elige el modelo más adecuado.
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
  ollama: {
    base_url: "http://127.0.0.1:11434",
    default_model: "gemma2:9b",
    api_key_env: "",
    known_models: [],
  },
  azure: {
    base_url: "",
    default_model: "",
    api_key_env: "AZURE_OPENAI_API_KEY",
    known_models: [],
  },
  mock: { base_url: "", default_model: "mock", api_key_env: "", known_models: ["mock"] },
  custom: { base_url: "", default_model: "", api_key_env: "", known_models: [] },
};

// Hydrate ENGINE_PRESETS from the daemon's shared catalog (GET /engines/presets,
// backed by src/core/engines/presets.js). Mutates the object in place so every
// consumer that reads ENGINE_PRESETS[engine] lazily (form handlers, model
// dropdowns) picks up the fresh lists. Best-effort: on failure we keep the
// baked-in fallback above. Call once at app boot.
let presetsLoaded = false;
export async function loadEnginePresets(): Promise<void> {
  if (presetsLoaded) return;
  try {
    const { Engines } = await import("../../../lib/api/engines");
    const { presets } = await Engines.presets();
    for (const [engine, preset] of Object.entries(presets || {})) {
      if (engine in ENGINE_PRESETS && preset) {
        Object.assign(ENGINE_PRESETS[engine as EngineType], preset);
      }
    }
    presetsLoaded = true;
  } catch {
    // Daemon unreachable or old build without the endpoint — keep the fallback.
  }
}
