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
import groq from "./groq.js";
import openrouter from "./openrouter.js";
import ollama from "./ollama.js";
import gemini from "./gemini.js";
import mock from "./mock.js";

const ADAPTERS = { anthropic, openai, groq, openrouter, ollama, gemini, mock };

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

export async function callEngine({ modelId, system, messages, config, temperature, maxTokens, tools, toolChoice, signal, onToken }) {
  const { provider, model } = resolveProvider(modelId);
  const adapter = getAdapter(provider);
  const providerCfg = (config && config.engines && config.engines[provider]) || {};
  // The per-provider `default_max_tokens` set in the web admin (Provider modal
  // slider) acts as a floor: callers may ask for more, but never less. This
  // matters for "thinking" models (e.g. Gemini 3.x) whose internal reasoning
  // tokens count against maxOutputTokens — too low a cap and the visible reply
  // gets truncated mid-sentence. Fallback chain:
  //   caller value → provider cfg → 2048 (safe baseline that survives thinking
  //   models without truncating; non-thinking models just don't fill it).
  const providerCap = Number(providerCfg.default_max_tokens) || 0;
  const callerCap = Number(maxTokens) || 0;
  const effectiveMaxTokens = Math.max(callerCap, providerCap) || 2048;
  return adapter.chat({
    system,
    messages,
    model,
    temperature,
    maxTokens: effectiveMaxTokens,
    tools,
    toolChoice,
    config: providerCfg,
    signal,
    onToken,
  });
}

export const ENGINE_IDS = Object.keys(ADAPTERS);
