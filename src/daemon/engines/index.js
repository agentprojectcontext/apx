// Engine adapter registry. Maps a model id → provider → adapter.
//
// Model id grammar (in agents.<slug>.model):
//   "<provider>:<model>"   explicit, e.g. "ollama:llama3.2", "anthropic:claude-haiku-4-5"
//   "<model>"              inferred: claude-* → anthropic, gpt-* → openai, gemini-* → gemini
//
// Each adapter exports a default object:
//   { id, chat({system, messages, model, temperature, maxTokens}) → {text, usage, raw} }
//
// API keys come from ~/.apx/config.json `engines.<provider>.api_key` or env vars
// (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY).
// Ollama needs no key, just a base_url (default http://localhost:11434).

import anthropic from "./anthropic.js";
import openai from "./openai.js";
import ollama from "./ollama.js";
import gemini from "./gemini.js";
import mock from "./mock.js";

const ADAPTERS = { anthropic, openai, ollama, gemini, mock };

export function resolveProvider(modelId) {
  if (typeof modelId !== "string" || !modelId) {
    throw new Error("model id is empty");
  }
  if (modelId.includes(":")) {
    const [provider, ...rest] = modelId.split(":");
    return { provider: provider.toLowerCase(), model: rest.join(":") };
  }
  if (/^claude/i.test(modelId)) return { provider: "anthropic", model: modelId };
  if (/^gpt|^o1|^o3|^o4/i.test(modelId)) return { provider: "openai", model: modelId };
  if (/^gemini/i.test(modelId)) return { provider: "gemini", model: modelId };
  if (modelId === "mock") return { provider: "mock", model: "mock" };
  throw new Error(
    `cannot infer provider for model "${modelId}" — use explicit "<provider>:<model>" form`
  );
}

export function getAdapter(provider) {
  const a = ADAPTERS[provider];
  if (!a) {
    throw new Error(
      `unknown engine provider "${provider}". Known: ${Object.keys(ADAPTERS).join(", ")}`
    );
  }
  return a;
}

export async function callEngine({ modelId, system, messages, config, temperature, maxTokens, tools, toolChoice }) {
  const { provider, model } = resolveProvider(modelId);
  const adapter = getAdapter(provider);
  const providerCfg =
    (config && config.engines && config.engines[provider]) || {};
  return adapter.chat({
    system,
    messages,
    model,
    temperature,
    maxTokens,
    tools,
    toolChoice,
    config: providerCfg,
  });
}

export const ENGINE_IDS = Object.keys(ADAPTERS);
