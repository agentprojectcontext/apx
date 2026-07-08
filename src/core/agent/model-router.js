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

export function isFallbackEnabled(globalConfig) {
  const fb = globalConfig?.super_agent?.model_fallback || {};
  return fb.enabled !== false;
}

// ---------------------------------------------------------------------------
// Content-based routing (OpenHands RouterLLM pattern). Static engine routing
// picks ONE model per deployment; these rules inspect the actual turn —
// images, prompt/context size, channel, keywords — and prefer a different
// model for it. The preferred model still goes through the same health check
// and falls back down the regular chain when unavailable, so a routing rule
// can never strand a turn on a dead provider.
// ---------------------------------------------------------------------------

export function routingConfig(globalConfig) {
  const raw = globalConfig?.super_agent?.routing || {};
  return {
    enabled: raw.enabled === true,
    rules: Array.isArray(raw.rules) ? raw.rules : [],
  };
}

// Multimodal content shows up as parts arrays on message content (engine
// adapters and the Telegram photo flow use type "image"/"image_url").
function contentHasImage(content) {
  if (!Array.isArray(content)) return false;
  return content.some(
    (p) => p && (p.type === "image" || p.type === "image_url" || p.type === "input_image")
  );
}

/**
 * Evaluate `super_agent.routing.rules` in order against the turn's features;
 * first full match wins. Each rule: `{ model: "<provider>:<model>", when: {
 * has_image?, min_prompt_chars?, max_prompt_chars?, min_context_chars?,
 * channels?: [], keywords?: [] } }`. All conditions in `when` must hold
 * (AND); an empty `when` matches every turn. Returns `{model, ruleIndex}` or
 * null (no rules, disabled, or nothing matched).
 */
export function selectModelByRules(
  { prompt = "", previousMessages = [], channel = "", channelMeta = {} } = {},
  globalConfig
) {
  const cfg = routingConfig(globalConfig);
  if (!cfg.enabled || cfg.rules.length === 0) return null;

  const promptText = typeof prompt === "string" ? prompt : "";
  const messages = Array.isArray(previousMessages) ? previousMessages : [];
  const hasImage =
    channelMeta?.has_image === true ||
    contentHasImage(prompt) ||
    messages.some((m) => contentHasImage(m?.content));
  let contextChars = 0;
  for (const m of messages) {
    const c = m?.content;
    if (typeof c === "string") contextChars += c.length;
    else if (c != null) {
      try { contextChars += JSON.stringify(c).length; } catch { /* unserializable — skip */ }
    }
  }

  for (let i = 0; i < cfg.rules.length; i++) {
    const rule = cfg.rules[i] || {};
    const model = rule.model;
    if (typeof model !== "string" || !model.includes(":")) continue;
    const when = rule.when || {};

    if (when.has_image === true && !hasImage) continue;
    if (when.has_image === false && hasImage) continue;
    if (Number.isFinite(when.min_prompt_chars) && promptText.length < when.min_prompt_chars) continue;
    if (Number.isFinite(when.max_prompt_chars) && promptText.length > when.max_prompt_chars) continue;
    if (Number.isFinite(when.min_context_chars) && contextChars < when.min_context_chars) continue;
    if (Array.isArray(when.channels) && when.channels.length > 0 && !when.channels.includes(channel)) continue;
    if (Array.isArray(when.keywords) && when.keywords.length > 0) {
      const low = promptText.toLowerCase();
      const hit = when.keywords.some(
        (k) => typeof k === "string" && k.trim().length >= 2 && low.includes(k.toLowerCase())
      );
      if (!hit) continue;
    }

    return { model, ruleIndex: i };
  }
  return null;
}

/**
 * Pick first healthy model following configured provider order.
 */
export async function resolveActiveModel(globalConfig, { overrideModel = null, preferredModel = null, timeoutMs } = {}) {
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
  // Content routing (selectModelByRules) prefers a model for THIS turn. It
  // leads the chain but is not forced: unhealthy → regular chain takes over.
  const preferred =
    typeof preferredModel === "string" && preferredModel.includes(":") ? preferredModel : null;

  if (isFallbackEnabled(globalConfig)) {
    // Build the full chain: preferred (content-routed) first, then primary,
    // then the fallback list, deduped. Each entry is a fully-qualified
    // "<provider>:<model>" string.
    const chain = [];
    if (preferred) chain.push(preferred);
    if (typeof sa.model === "string" && sa.model.includes(":") && !chain.includes(sa.model)) {
      chain.push(sa.model);
    }
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
          fromFallback: !isPrimary && modelId !== preferred,
          ...(modelId === preferred ? { routedBy: "content_rules" } : {}),
          tried,
        };
      }
    }
  } else if (preferred) {
    // No fallback router: honor the routing rule directly (same trust level
    // as the primary model, which is also unchecked in this branch).
    const { provider } = parseModelId(preferred);
    return {
      modelId: preferred,
      provider,
      fromFallback: false,
      forced: true,
      routedBy: "content_rules",
      tried: [{ provider, modelId: preferred, healthy: true, reason: "content_rules" }],
    };
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
  const models = fallbackModels(globalConfig);
  // Build a deduped list of {provider, model} in chain order. Fall back to
  // DEFAULT_FALLBACK_ORDER + DEFAULT_FALLBACK_MODELS when nothing is configured.
  const entries = [];
  const seen = new Set();
  for (const m of models) {
    let provider;
    try { provider = parseModelId(m).provider; } catch { continue; }
    if (seen.has(provider)) continue;
    seen.add(provider);
    entries.push({ provider, model: m });
  }
  if (entries.length === 0) {
    for (const provider of DEFAULT_FALLBACK_ORDER) {
      const m = DEFAULT_FALLBACK_MODELS[provider];
      entries.push({ provider, model: m || "(not set)" });
    }
  }

  const out = [];
  for (const { provider, model } of entries) {
    const health = await checkProviderHealth(provider, globalConfig, timeoutMs);
    out.push({ provider, model, ...health });
  }
  return out;
}
