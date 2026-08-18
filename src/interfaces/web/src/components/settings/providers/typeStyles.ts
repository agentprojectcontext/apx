// Visual styles per provider engine (adapter). Maps the engine id to a
// gradient (card icon) and a badge class. Ported/adapted from pandaproject.

import { toneChip } from "../../../lib/tone";

export type EngineType =
  | "anthropic" | "openai" | "gemini" | "groq"
  | "openrouter" | "ollama" | "azure" | "zen" | "mock" | "custom";

export const ENGINE_GRADIENTS: Record<EngineType, string> = {
  anthropic:  "from-orange-600 to-amber-600",
  openai:     "from-emerald-600 to-teal-600",
  gemini:     "from-blue-600 to-indigo-600",
  groq:       "from-cyan-600 to-teal-600",
  openrouter: "from-violet-600 to-indigo-600",
  ollama:     "from-amber-600 to-orange-600",
  azure:      "from-blue-600 to-cyan-600",
  zen:        "from-fuchsia-600 to-purple-600",
  mock:       "from-slate-600 to-gray-600",
  custom:     "from-slate-600 to-gray-600",
};

export const ENGINE_BADGES: Record<EngineType, string> = {
  anthropic:  toneChip.orange,
  openai:     toneChip.emerald,
  gemini:     toneChip.blue,
  groq:       toneChip.cyan,
  openrouter: toneChip.violet,
  ollama:     toneChip.amber,
  azure:      toneChip.blue,
  zen:        toneChip.violet,
  mock:       toneChip.slate,
  custom:     toneChip.slate,
};

export const ENGINE_OPTIONS: { value: EngineType; label: string }[] = [
  { value: "anthropic",  label: "Anthropic" },
  { value: "openai",     label: "OpenAI-compatible" },
  { value: "gemini",     label: "Gemini" },
  { value: "groq",       label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "ollama",     label: "Ollama" },
  { value: "azure",      label: "Azure OpenAI" },
  { value: "zen",        label: "OpenCode Zen" },
  { value: "mock",       label: "Mock (test)" },
  { value: "custom",     label: "Custom" },
];

export function engineStyle<T>(map: Record<EngineType, T>, value: string | null | undefined): T {
  if (value && value in map) return map[value as EngineType];
  return map.custom;
}

// Icon per engine (lucide name). Used in provider cards + selects.
import { Sparkles, Bot, Gem, Zap, GitBranch, Server, Cloud, Leaf, FlaskConical, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const ENGINE_ICONS: Record<EngineType, LucideIcon> = {
  anthropic:  Sparkles,
  openai:     Bot,
  gemini:     Gem,
  groq:       Zap,
  openrouter: GitBranch,
  ollama:     Server,
  azure:      Cloud,
  zen:        Leaf,
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
    known_models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano"],
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
      "anthropic/claude-opus-5",
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "google/gemini-3.7-flash",
      "qwen/qwen3.8-27b",
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
  zen: {
    base_url: "https://opencode.ai/zen/v1",
    default_model: "big-pickle",
    api_key_env: "OPENCODE_ZEN_API_KEY",
    known_models: [
      "big-pickle",
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "deepseek-v4-flash-free",
      "laguna-s-2.1-free",
      "mimo-v2.5-free",
      "hy3-free",
    ],
  },
  mock: { base_url: "", default_model: "mock", api_key_env: "", known_models: ["mock"] },
  custom: { base_url: "", default_model: "", api_key_env: "", known_models: [] },
};

// Hydrate ENGINE_PRESETS from the daemon's shared catalog (GET /engines/presets,
// backed by src/core/engines/presets.js). Mutates the object in place so every
// consumer that reads ENGINE_PRESETS[engine] lazily (form handlers, model
// dropdowns) picks up the fresh lists.
//
// The endpoint needs the bearer token, so this runs AFTER the token bootstrap
// (see useTokenBootstrap) — calling it at module load only ever got a 401 and
// silently left the bundled list in place.
//
// Model lists MERGE rather than replace: a daemon that has not been restarted
// since the last upgrade must not drop models this build knows about, and a
// daemon ahead of this build can still add ones it does not. Scalars only
// overwrite when the daemon actually has a value.
let presetsLoaded = false;
export async function loadEnginePresets(): Promise<void> {
  if (presetsLoaded) return;
  try {
    const { Engines } = await import("../../../lib/api/engines");
    const { presets } = await Engines.presets();
    for (const [engine, preset] of Object.entries(presets || {})) {
      const local = ENGINE_PRESETS[engine as EngineType];
      if (!local || !preset) continue;
      local.known_models = Array.from(new Set([...local.known_models, ...(preset.known_models || [])]));
      if (preset.base_url) local.base_url = preset.base_url;
      if (preset.default_model) local.default_model = preset.default_model;
      if (preset.api_key_env) local.api_key_env = preset.api_key_env;
    }
    presetsLoaded = true;
  } catch {
    // Daemon unreachable, unauthenticated, or an old build without the
    // endpoint — keep the bundled catalog and let a later call retry.
  }
}
