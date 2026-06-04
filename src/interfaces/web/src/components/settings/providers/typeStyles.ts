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
export interface EnginePreset {
  base_url: string;
  default_model: string;
  api_key_env: string;
  known_models: string[];
}

export const ENGINE_PRESETS: Record<EngineType, EnginePreset> = {
  anthropic: {
    base_url: "",
    default_model: "claude-sonnet-4.6",
    api_key_env: "ANTHROPIC_API_KEY",
    known_models: [
      "claude-opus-4.8",
      "claude-opus-4.7",
      "claude-opus-4.6",
      "claude-sonnet-4.6",
      "claude-sonnet-4.5",
      "claude-haiku-4.5",
    ],
  },
  openai: {
    base_url: "https://api.openai.com/v1",
    default_model: "gpt-4o-mini",
    api_key_env: "OPENAI_API_KEY",
    known_models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
  },
  gemini: {
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    default_model: "gemini-2.5-flash",
    api_key_env: "GEMINI_API_KEY",
    known_models: [
      "gemini-3.5-pro",
      "gemini-3.5-flash",
      "gemini-3.1-pro",
      "gemini-3.1-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
  },
  groq: {
    base_url: "https://api.groq.com/openai/v1",
    default_model: "llama-3.3-70b-versatile",
    api_key_env: "GROQ_API_KEY",
    known_models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "groq/compound",
      "groq/compound-mini",
      "qwen/qwen3-32b",
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
      "deepseek/deepseek-r1:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
      "qwen/qwen3-235b-a22b:free",
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-4o-mini",
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
    default_model: "gpt-4o-mini",
    api_key_env: "AZURE_OPENAI_API_KEY",
    known_models: ["gpt-4o", "gpt-4o-mini"],
  },
  mock: { base_url: "", default_model: "mock", api_key_env: "", known_models: ["mock"] },
  custom: { base_url: "", default_model: "", api_key_env: "", known_models: [] },
};
