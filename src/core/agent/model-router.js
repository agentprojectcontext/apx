// Model router: thin orchestrator over engine adapters.
//
// What used to be a long per-provider switch (health checks, env-var maps,
// default fallback models, base URLs) now lives in each adapter under
// src/core/engines/<provider>.js. The router only knows the grammar of model
// ids and the algorithm of trying the chain in order. Per-provider details
// are owned by the provider.
import { getAdapter } from "../engines/index.js";

export function parseModelId(modelId) {
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
  throw new Error(`cannot infer provider for model "${modelId}"`);
}

// Default chain when no super_agent.model_fallback is configured. Order: the
// cloud providers that have a published default model id. Ollama isn't here
// because it depends on the user's pulled models. Anthropic/Gemini neither
// (key-gated, no canonical free fallback).
export const DEFAULT_FALLBACK_ORDER = ["openrouter", "groq"];

// Built on demand from each adapter's `defaultFallbackModel`. Kept as a
// getter so adding an engine doesn't require updating this file.
function getDefaultFallbackModels() {
  const map = {};
  for (const id of DEFAULT_FALLBACK_ORDER) {
    try {
      const a = getAdapter(id);
      if (a?.defaultFallbackModel) map[id] = a.defaultFallbackModel;
    } catch { /* missing adapter — skip */ }
  }
  return map;
}
export const DEFAULT_FALLBACK_MODELS = getDefaultFallbackModels();

function engineCfg(config, provider) {
  return (config?.engines && config.engines[provider]) || {};
}

/**
 * Delegate to the provider's adapter for the actual probe. The router used to
 * have a per-provider switch here; that's now adapter responsibility.
 *
 * `candidateModel` is the bare model id (no "<provider>:" prefix). Adapters
 * that care (Ollama strict mode) use it; others ignore it.
 */
export async function checkProviderHealth(provider, config, timeoutMs = 800, opts = {}) {
  const p = String(provider || "").toLowerCase();
  let adapter;
  try {
    adapter = getAdapter(p);
  } catch {
    return { ok: false, provider: p, reason: "unknown provider" };
  }
  if (typeof adapter.health !== "function") {
    return { ok: false, provider: p, reason: "adapter has no health()" };
  }
  return adapter.health(engineCfg(config, p), { timeoutMs, candidateModel: opts.candidateModel || null });
}

/**
 * Return the fallback chain as a flat list of model ids in the order they
 * should be attempted. Each item is a fully-qualified `<provider>:<model>`
 * string — no separate `order` array, no `models{provider}` map.
 *
 * Reads three formats, in priority order:
 *
 *  1. **New (preferred)**: `model_fallback.models` is an array of strings.
 *     Order = array order. Each string carries its own provider prefix.
 *
 *       "model_fallback": { "models": ["openrouter:foo", "groq:bar"] }
 *
 *  2. **Legacy**: `model_fallback.order` is a provider list +
 *     `model_fallback.models` is `{ <provider>: "<provider>:<model>" }`.
 *     Walked in `order`; missing entries fill from DEFAULT_FALLBACK_MODELS or
 *     (for Ollama) from `super_agent.model`.
 *
 *  3. **None**: no fallback configured → defaults derived from
 *     DEFAULT_FALLBACK_ORDER + DEFAULT_FALLBACK_MODELS.
 *
 * The primary model (`super_agent.model`) is NOT included here — it's tried
 * first by `resolveActiveModel`. This function returns only the alternates.
 */
export function fallbackModels(globalConfig) {
  const sa = globalConfig?.super_agent || {};
  const fb = sa.model_fallback || {};

  // Format 1 — new
  if (Array.isArray(fb.models)) {
    return fb.models
      .filter((m) => typeof m === "string" && m.includes(":"))
      .map(String);
  }

  // Format 2 — legacy
  const legacyMap = fb.models && typeof fb.models === "object" ? fb.models : null;
  const order = Array.isArray(fb.order) ? fb.order.map(String) : null;
  if (legacyMap || order) {
    const chain = order || DEFAULT_FALLBACK_ORDER;
    const out = [];
    for (const provider of chain) {
      const p = String(provider).toLowerCase();
      let model = legacyMap?.[p];
      if (!model) {
        if (p === "ollama" && typeof sa.model === "string" && /^ollama:/i.test(sa.model)) {
          model = sa.model;
        } else if (DEFAULT_FALLBACK_MODELS[p]) {
          model = DEFAULT_FALLBACK_MODELS[p];
        }
      }
      if (model && typeof model === "string" && model.includes(":")) out.push(model);
    }
    return out;
  }

  // Format 3 — empty config, derive from defaults
  return DEFAULT_FALLBACK_ORDER
    .map((p) => DEFAULT_FALLBACK_MODELS[p])
    .filter((m) => typeof m === "string" && m.includes(":"));
}

/**
 * @deprecated use fallbackModels(). Kept for tests / external callers that
 * still ask "what provider to try after Ollama?". Derives the answer from the
 * resolved model chain.
 */
export function fallbackOrder(globalConfig) {
  const models = fallbackModels(globalConfig);
  const providers = [];
  for (const m of models) {
    try {
      const p = parseModelId(m).provider;
      if (!providers.includes(p)) providers.push(p);
    } catch { /* skip malformed entries */ }
  }
  return providers.length ? providers : [...DEFAULT_FALLBACK_ORDER];
}

/**
 * @deprecated use fallbackModels(). Looks up a single provider's model in
 * the resolved chain. Returns "" if the provider isn't in the fallback list.
 */
export function modelForProvider(globalConfig, provider) {
  const p = String(provider).toLowerCase();
  const sa = globalConfig?.super_agent || {};
  const models = fallbackModels(globalConfig);
  const match = models.find((m) => {
    try { return parseModelId(m).provider === p; } catch { return false; }
  });
  if (match) return match;
  // Ollama gets a special fallback to the primary model (legacy behavior).
  if (p === "ollama" && typeof sa.model === "string" && /^ollama:/i.test(sa.model)) {
    return sa.model;
  }
  return DEFAULT_FALLBACK_MODELS[p] || "";
}

export function isFallbackEnabled(globalConfig) {
  const fb = globalConfig?.super_agent?.model_fallback || {};
  return fb.enabled !== false;
}

/**
 * Pick first healthy model following configured provider order.
 */
export async function resolveActiveModel(globalConfig, { overrideModel = null, timeoutMs } = {}) {
  if (overrideModel) {
    const { provider } = parseModelId(overrideModel);
    return {
      modelId: overrideModel,
      provider,
      fromFallback: false,
      forced: true,
      tried: [{ provider, modelId: overrideModel, healthy: true, reason: "override" }],
    };
  }

  const sa = globalConfig?.super_agent || {};
  const fb = sa.model_fallback || {};
  const healthMs = timeoutMs ?? fb.health_timeout_ms ?? 800;
  const tried = [];

  if (isFallbackEnabled(globalConfig)) {
    // Build the full chain: primary first, then the fallback list, deduped.
    // Each entry is a fully-qualified "<provider>:<model>" string.
    const chain = [];
    if (typeof sa.model === "string" && sa.model.includes(":")) chain.push(sa.model);
    for (const m of fallbackModels(globalConfig)) {
      if (!chain.includes(m)) chain.push(m);
    }

    for (const modelId of chain) {
      let provider;
      try {
        provider = parseModelId(modelId).provider;
      } catch (e) {
        tried.push({ provider: null, modelId, healthy: false, reason: e.message });
        continue;
      }
      const candidateModel = parseModelId(modelId).model;
      const health = await checkProviderHealth(provider, globalConfig, healthMs, { candidateModel });
      tried.push({
        provider,
        modelId,
        healthy: health.ok,
        reason: health.reason || (health.ok ? "ok" : "unhealthy"),
        soft: health.soft,
        available: health.available, // for "model not loaded" diagnostics
      });
      if (health.ok) {
        const isPrimary = modelId === sa.model;
        return {
          modelId,
          provider,
          fromFallback: !isPrimary,
          tried,
        };
      }
    }
  }

  if (sa.model) {
    const { provider } = parseModelId(sa.model);
    return {
      modelId: sa.model,
      provider,
      fromFallback: false,
      forced: true,
      tried,
    };
  }

  throw new Error("no model configured (set super_agent.model in ~/.apx/config.json)");
}

export async function probeAllProviders(globalConfig, timeoutMs) {
  const order = fallbackOrder(globalConfig);
  const out = [];
  for (const provider of order) {
    const health = await checkProviderHealth(provider, globalConfig, timeoutMs);
    out.push({
      provider,
      model: modelForProvider(globalConfig, provider) || "(not set)",
      ...health,
    });
  }
  return out;
}
