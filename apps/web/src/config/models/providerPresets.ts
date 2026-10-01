// Kinds of model APIs the owner can add, with their usual address. Only a starting point: every field is editable.
import type { TileTone } from "@apx/ui";

export type ProviderPreset = {
  id: string;
  label: string;
  transport: "openai-chat" | "anthropic-messages";
  base_url: string;
  needs_key: boolean;
  tone: TileTone;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "opencode-zen",
    label: "OpenCode Zen",
    transport: "openai-chat",
    base_url: "https://opencode.ai/zen/v1",
    needs_key: true,
    tone: "violet",
  },
  {
    id: "gemini",
    label: "Gemini",
    transport: "openai-chat",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    needs_key: true,
    tone: "info",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    transport: "anthropic-messages",
    base_url: "https://api.anthropic.com",
    needs_key: true,
    tone: "warning",
  },
  {
    id: "openai",
    label: "OpenAI",
    transport: "openai-chat",
    base_url: "https://api.openai.com/v1",
    needs_key: true,
    tone: "brand",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    transport: "openai-chat",
    base_url: "https://openrouter.ai/api/v1",
    needs_key: true,
    tone: "violet",
  },
  {
    id: "groq",
    label: "Groq",
    transport: "openai-chat",
    base_url: "https://api.groq.com/openai/v1",
    needs_key: true,
    tone: "info",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    transport: "openai-chat",
    base_url: "https://api.cerebras.ai/v1",
    needs_key: true,
    tone: "danger",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    transport: "openai-chat",
    base_url: "https://api.deepseek.com/v1",
    needs_key: true,
    tone: "info",
  },
  {
    id: "mistral",
    label: "Mistral",
    transport: "openai-chat",
    base_url: "https://api.mistral.ai/v1",
    needs_key: true,
    tone: "warning",
  },
  {
    id: "ollama",
    label: "Ollama",
    transport: "openai-chat",
    base_url: "http://localhost:11434/v1",
    needs_key: false,
    tone: "neutral",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    transport: "openai-chat",
    base_url: "http://localhost:1234/v1",
    needs_key: false,
    tone: "neutral",
  },
  {
    id: "custom",
    label: "OpenAI-compatible",
    transport: "openai-chat",
    base_url: "",
    needs_key: true,
    tone: "neutral",
  },
];

export const presetOf = (id: string | undefined) =>
  PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS.find((p) => p.id === "custom");
