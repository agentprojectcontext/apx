// Embeddings engine registry for the cross-channel memory RAG. Mirrors the TTS
// engine selector at src/core/voice/engines/index.js so configuring an
// embeddings provider feels identical to configuring TTS/STT.
//
// Config lives at config.memory.embeddings:
//   provider: "auto" | "ollama" | "openai" | "gemini" | "tf"
//   mode:     "chain" (ordered fallback router) | "single" (use provider verbatim)
//   order:    custom chain order (ids); the rest of AUTO_PREFERENCE is appended
//   <id>:     per-engine settings ({ model, api_key, base_url, timeout_ms })
//
// Two selection modes:
//   "chain"  — walk the order, skip engines turned off (<id>.enabled === false),
//              pick the first whose isAvailable() returns true. "tf" is always
//              kept as the final guaranteed fallback.
//   "single" — use exactly memory.embeddings.provider, no fallback.
//
// An explicit `provider` argument always wins (used by the "test embedding" UI).
// Cosine similarity is only meaningful within one embedder space, so every
// vector is tagged with its `embedder` and the store filters search() on it —
// switching provider strands the old index until it is re-embedded.

import ollama from "./ollama.js";
import openai from "./openai.js";
import gemini from "./gemini.js";
import tf from "./tf.js";

const ADAPTERS = { ollama, openai, gemini, tf };
export const EMBED_ENGINE_IDS = Object.keys(ADAPTERS);

// Local-first, then free-with-key, then paid, then offline fallback.
export const AUTO_PREFERENCE = ["ollama", "gemini", "openai", "tf"];

export function getEmbedAdapter(provider) {
  const a = ADAPTERS[provider];
  if (!a) {
    throw new Error(
      `unknown embeddings provider "${provider}". Known: ${EMBED_ENGINE_IDS.join(", ")}`
    );
  }
  return a;
}

export function embeddingsConfig(globalConfig) {
  const mem = globalConfig?.memory || {};
  // Back-compat: older configs only had the flat memory.embed_* keys. Fold them
  // into a synthetic ollama engine config so they keep working unchanged.
  const section = mem.embeddings || {};
  if (!section.ollama && (mem.embed_model || mem.embed_base_url || mem.embed_timeout_ms)) {
    return {
      provider: section.provider || "auto",
      mode: section.mode,
      order: section.order,
      ...section,
      ollama: {
        model: mem.embed_model || "nomic-embed-text",
        base_url: mem.embed_base_url || "",
        timeout_ms: mem.embed_timeout_ms || 4000,
      },
    };
  }
  return section;
}

function providerConfig(globalConfig, provider) {
  return embeddingsConfig(globalConfig)?.[provider] || {};
}

function isEnabled(embedCfg, id) {
  return embedCfg?.[id]?.enabled !== false;
}

/** Effective routing mode for the chain/single decision. */
export function resolveMode(embedCfg) {
  if (embedCfg?.mode === "chain" || embedCfg?.mode === "single") return embedCfg.mode;
  const p = embedCfg?.provider;
  return p && p !== "auto" ? "single" : "chain";
}

/** Full chain order: user's custom order (known ids only) then the rest; tf last. */
export function resolveChainOrder(embedCfg) {
  const custom = Array.isArray(embedCfg?.order)
    ? embedCfg.order.filter((id) => EMBED_ENGINE_IDS.includes(id))
    : [];
  const rest = AUTO_PREFERENCE.filter((id) => !custom.includes(id));
  const full = [...custom, ...rest];
  if (!full.includes("tf")) full.push("tf");
  return full;
}

/**
 * Resolve which embeddings engine should handle this call.
 * Returns { provider, adapter, engineConfig }.
 */
export async function selectEmbedEngine({ globalConfig, provider }) {
  const embedCfg = embeddingsConfig(globalConfig);

  // 1. Explicit override (tester / API caller) always wins.
  if (provider && provider !== "auto") {
    const adapter = getEmbedAdapter(provider);
    return { provider, adapter, engineConfig: providerConfig(globalConfig, provider) };
  }

  const mode = resolveMode(embedCfg);

  // 2. Single mode: use the configured engine verbatim, no fallback.
  if (mode === "single") {
    const id = embedCfg?.provider;
    if (id && id !== "auto") {
      const adapter = getEmbedAdapter(id);
      return { provider: id, adapter, engineConfig: providerConfig(globalConfig, id) };
    }
    // Misconfigured single mode → fall through to chain.
  }

  // 3. Chain mode: probe the (enabled) order, first available wins.
  for (const id of resolveChainOrder(embedCfg)) {
    if (id !== "tf" && !isEnabled(embedCfg, id)) continue;
    const adapter = ADAPTERS[id];
    const cfg = providerConfig(globalConfig, id);
    try {
      if (await adapter.isAvailable(cfg, globalConfig?.engines)) {
        return { provider: id, adapter, engineConfig: cfg };
      }
    } catch { /* probe failures fall through */ }
  }
  return { provider: "tf", adapter: tf, engineConfig: providerConfig(globalConfig, "tf") };
}

/** Discover which engines are configured/available right now. */
export async function listAvailableEmbedEngines(globalConfig) {
  const embedCfg = embeddingsConfig(globalConfig);
  const out = [];
  for (const id of EMBED_ENGINE_IDS) {
    const adapter = ADAPTERS[id];
    const cfg = providerConfig(globalConfig, id);
    let available = false;
    try {
      available = await adapter.isAvailable(cfg, globalConfig?.engines);
    } catch { available = false; }
    out.push({
      id,
      available,
      configured: Object.keys(cfg).filter((k) => k !== "enabled").length > 0,
      enabled: isEnabled(embedCfg, id),
    });
  }
  return out;
}
