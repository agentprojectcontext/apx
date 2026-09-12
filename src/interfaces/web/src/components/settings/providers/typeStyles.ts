// Visual styles per provider engine (adapter). Maps the engine id to a
// gradient (card icon) and a badge class. Ported/adapted from pandaproject.

import { toneChip } from "../../../lib/tone";

// The engines this build ships styling for.
export type KnownEngine =
  | "anthropic" | "openai" | "gemini" | "groq" | "cerebras"
  | "openrouter" | "ollama" | "azure" | "zen" | "mock" | "custom";

// Any adapter id the daemon reports is valid, not just the ones above: core can
// register an engine (src/core/engines/index.js) and the panel has to offer it
// without waiting for a web release. `string & {}` keeps editor autocomplete for
// the known ids while still accepting an unknown one, which then renders with
// the generic look via engineStyle().
export type EngineType = KnownEngine | (string & {});

export const ENGINE_GRADIENTS: Record<KnownEngine, string> = {
  anthropic:  "from-orange-600 to-amber-600",
  openai:     "from-emerald-600 to-teal-600",
  gemini:     "from-blue-600 to-indigo-600",
  groq:       "from-cyan-600 to-teal-600",
  cerebras:   "from-rose-600 to-red-600",
  openrouter: "from-violet-600 to-indigo-600",
  ollama:     "from-amber-600 to-orange-600",
  azure:      "from-blue-600 to-cyan-600",
  zen:        "from-fuchsia-600 to-purple-600",
  mock:       "from-slate-600 to-gray-600",
  custom:     "from-slate-600 to-gray-600",
};

export const ENGINE_BADGES: Record<KnownEngine, string> = {
  anthropic:  toneChip.orange,
  openai:     toneChip.emerald,
  gemini:     toneChip.blue,
  groq:       toneChip.cyan,
  cerebras:   toneChip.rose,
  openrouter: toneChip.violet,
  ollama:     toneChip.amber,
  azure:      toneChip.blue,
  zen:        toneChip.violet,
  mock:       toneChip.slate,
  custom:     toneChip.slate,
};

// Mutable ON PURPOSE: loadEnginePresets() appends any engine the daemon knows
// and this build does not. Consumers read it lazily (.map/.find at render), so
// an in-place append reaches them without a rebuild.
export const ENGINE_OPTIONS: { value: EngineType; label: string }[] = [
  { value: "anthropic",  label: "Anthropic" },
  { value: "openai",     label: "OpenAI-compatible" },
  { value: "gemini",     label: "Gemini" },
  { value: "groq",       label: "Groq" },
  { value: "cerebras",   label: "Cerebras" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "ollama",     label: "Ollama" },
  { value: "azure",      label: "Azure OpenAI" },
  { value: "zen",        label: "OpenCode Zen" },
  { value: "mock",       label: "Mock (test)" },
  { value: "custom",     label: "Custom" },
];

/** Style for an engine, falling back to the generic look for an unknown one. */
export function engineStyle<T>(map: Record<KnownEngine, T>, value: string | null | undefined): T {
  if (value && value in map) return map[value as KnownEngine];
  return map.custom;
}

// Icon per engine (lucide name). Used in provider cards + selects.
import { Sparkles, Bot, Gem, Zap, Cpu, GitBranch, Server, Cloud, Leaf, FlaskConical, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const ENGINE_ICONS: Record<KnownEngine, LucideIcon> = {
  anthropic:  Sparkles,
  openai:     Bot,
  gemini:     Gem,
  groq:       Zap,
  cerebras:   Cpu,
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
  /**
   * This engine answers without an api_key of its own (Ollama needs none, Zen
   * ships a built-in default). A CONFIGURATION fact, not a health one: it says
   * the provider is usable as configured, never that a call will succeed.
   */
  key_optional?: boolean;
}

export const ENGINE_PRESETS: Record<string, EnginePreset> = {
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
    ],
  },
  cerebras: {
    base_url: "https://api.cerebras.ai/v1",
    default_model: "qwen-3.8-27b",
    api_key_env: "CEREBRAS_API_KEY",
    known_models: ["qwen-3.8-27b", "gpt-oss-120b", "gemma-4-31b"],
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
    key_optional: true,
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
    key_optional: true,
    base_url: "https://opencode.ai/zen/v1",
    default_model: "big-pickle",
    // Free tier: literal "public" + User-Agent opencode/* (engine injects UA).
    // Paid models need a real OpenCode Zen key.
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
  mock: { base_url: "", default_model: "mock", api_key_env: "", known_models: ["mock"], key_optional: true },
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
/** Display name for an adapter this build ships no label for: "cerebras" → "Cerebras". */
function labelForEngine(engine: string): string {
  return engine.charAt(0).toUpperCase() + engine.slice(1);
}

let presetsLoaded = false;
export async function loadEnginePresets(): Promise<void> {
  if (presetsLoaded) return;
  try {
    const { Engines } = await import("../../../lib/api/engines");
    const { presets } = await Engines.presets();
    for (const [engine, preset] of Object.entries(presets || {})) {
      if (!preset) continue;
      let local = ENGINE_PRESETS[engine];
      // An engine this build has never heard of is ADOPTED, not skipped. Core
      // registering an adapter used to mean six parallel edits here before the
      // panel would even list it; dropping it silently is what made a new
      // engine invisible in the provider dialog while the CLI already had it.
      if (!local) {
        local = { base_url: "", default_model: "", api_key_env: "", known_models: [] };
        ENGINE_PRESETS[engine] = local;
        if (!ENGINE_OPTIONS.some((o) => o.value === engine)) {
          ENGINE_OPTIONS.push({ value: engine, label: labelForEngine(engine) });
        }
      }
      local.known_models = Array.from(new Set([...local.known_models, ...(preset.known_models || [])]));
      if (preset.base_url) local.base_url = preset.base_url;
      if (preset.default_model) local.default_model = preset.default_model;
      if (preset.api_key_env) local.api_key_env = preset.api_key_env;
      // Booleans copy on presence, not truthiness: `false` from the daemon is
      // a real answer and must be able to clear a bundled `true`.
      if (typeof preset.key_optional === "boolean") local.key_optional = preset.key_optional;
    }
    presetsLoaded = true;
  } catch {
    // Daemon unreachable, unauthenticated, or an old build without the
    // endpoint — keep the bundled catalog and let a later call retry.
  }
}
