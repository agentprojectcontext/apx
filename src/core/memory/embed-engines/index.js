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
import custom from "./custom.js";
import tf from "./tf.js";

const ADAPTERS = { ollama, openai, gemini, tf };
export const EMBED_ENGINE_IDS = Object.keys(ADAPTERS);

// Local-first, then free-with-key, then paid, then offline fallback.
export const AUTO_PREFERENCE = ["ollama", "gemini", "openai", "tf"];

// ── Custom providers ────────────────────────────────────────────────────────
// Users can add any number of OpenAI-compatible /embeddings endpoints (a local
// Zen / LiteLLM / llama.cpp server). They live under memory.embeddings.custom
// .<slug> and surface with id "custom:<slug>", all backed by the custom adapter.
// Mirrors the TTS engine registry (src/core/voice/engines/index.js).
export const CUSTOM_PREFIX = "custom:";

export function isCustomId(id) {
  return typeof id === "string" && id.startsWith(CUSTOM_PREFIX);
}
function slugOf(id) {
  return isCustomId(id) ? id.slice(CUSTOM_PREFIX.length) : id;
}
function customEngineIds(embedCfg) {
  return Object.keys(embedCfg?.custom || {}).map((slug) => CUSTOM_PREFIX + slug);
}
function knownIds(embedCfg) {
  return [...EMBED_ENGINE_IDS, ...customEngineIds(embedCfg)];
}

export function getEmbedAdapter(provider) {
  // Every custom provider is OpenAI-compatible → the custom adapter.
  if (isCustomId(provider)) return custom;
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
  // memory.embed_* are the flat defaults every config ships with. With no
  // explicit `embeddings.ollama` block, fold them into a synthetic one.
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
  const emb = embeddingsConfig(globalConfig);
  // A custom provider's config lives under .custom.<slug>; inject its own id so
  // the adapter tags vectors with `custom:<slug>:model` (a distinct cosine space).
  if (isCustomId(provider)) {
    return { ...(emb?.custom?.[slugOf(provider)] || {}), _embedder_id: provider };
  }
  return emb?.[provider] || {};
}

function isEnabled(embedCfg, id) {
  if (isCustomId(id)) return embedCfg?.custom?.[slugOf(id)]?.enabled !== false;
  return embedCfg?.[id]?.enabled !== false;
}

/** Effective routing mode for the chain/single decision. */
export function resolveMode(embedCfg) {
  if (embedCfg?.mode === "chain" || embedCfg?.mode === "single") return embedCfg.mode;
  const p = embedCfg?.provider;
  return p && p !== "auto" ? "single" : "chain";
}

/** Full chain order: user's saved order (known ids only) then the rest, with tf
 *  ALWAYS last (the guaranteed offline floor). "Known" now includes every
 *  custom:<slug> so added providers can be reordered. */
export function resolveChainOrder(embedCfg) {
  const known = knownIds(embedCfg);
  const ordered = Array.isArray(embedCfg?.order)
    ? embedCfg.order.filter((id) => known.includes(id) && id !== "tf")
    : [];
  const rest = [...AUTO_PREFERENCE.filter((id) => id !== "tf"), ...customEngineIds(embedCfg)]
    .filter((id) => !ordered.includes(id));
  return [...ordered, ...rest, "tf"];
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
    const adapter = getEmbedAdapter(id);
    const cfg = providerConfig(globalConfig, id);
    try {
      if (await adapter.isAvailable(cfg, globalConfig?.engines)) {
        return { provider: id, adapter, engineConfig: cfg };
      }
    } catch { /* probe failures fall through */ }
  }
  return { provider: "tf", adapter: tf, engineConfig: providerConfig(globalConfig, "tf") };
}

/**
 * The ORDERED list of engines embedOne should try this call, first to last,
 * before the guaranteed tf floor. Unlike selectEmbedEngine (which picks ONE by
 * isAvailable), this returns every enabled+available engine in chain order so
 * embedOne can fall through to the next one when a call FAILS at runtime — a
 * rate-limited (429) or down provider, not just a keyless one. tf is omitted
 * here; embedOne appends it as the final fallback.
 * Returns [{ provider, adapter, engineConfig }].
 */
export async function selectEmbedChain({ globalConfig }) {
  const embedCfg = embeddingsConfig(globalConfig);

  // Single mode: exactly the configured engine, no fallback (matches the mode's
  // contract; embedOne still drops to tf if that one engine errors).
  if (resolveMode(embedCfg) === "single") {
    const id = embedCfg?.provider;
    if (id && id !== "auto" && (ADAPTERS[id] || isCustomId(id))) {
      return [{ provider: id, adapter: getEmbedAdapter(id), engineConfig: providerConfig(globalConfig, id) }];
    }
  }

  const out = [];
  for (const id of resolveChainOrder(embedCfg)) {
    if (id === "tf") continue;
    if (!isEnabled(embedCfg, id)) continue;
    let adapter;
    try { adapter = getEmbedAdapter(id); } catch { continue; }
    const cfg = providerConfig(globalConfig, id);
    try {
      if (await adapter.isAvailable(cfg, globalConfig?.engines)) {
        out.push({ provider: id, adapter, engineConfig: cfg });
      }
    } catch { /* probe failures skip the engine */ }
  }
  return out;
}

/** Discover which engines are configured/available right now — built-ins plus
 *  every user-added custom:<slug> provider. */
export async function listAvailableEmbedEngines(globalConfig) {
  const embedCfg = embeddingsConfig(globalConfig);
  const out = [];
  for (const id of knownIds(embedCfg)) {
    const adapter = getEmbedAdapter(id);
    const cfg = providerConfig(globalConfig, id);
    let available = false;
    try {
      available = await adapter.isAvailable(cfg, globalConfig?.engines);
    } catch { available = false; }
    out.push({
      id,
      available,
      // `_embedder_id` is injected for custom blocks, not user-set config.
      configured: Object.keys(cfg).filter((k) => k !== "enabled" && k !== "_embedder_id").length > 0,
      enabled: isEnabled(embedCfg, id),
      ...(isCustomId(id) ? { custom: true, label: cfg.label || slugOf(id) } : {}),
    });
  }
  return out;
}
