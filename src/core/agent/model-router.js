// Model router: quick provider health checks + ordered fallback.

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

export const DEFAULT_FALLBACK_ORDER = ["ollama", "openrouter", "groq"];

export const DEFAULT_FALLBACK_MODELS = {
  openrouter: "openrouter:meta-llama/llama-3.3-70b-instruct",
  groq: "groq:llama-3.3-70b-versatile",
};

function engineCfg(config, provider) {
  return (config?.engines && config.engines[provider]) || {};
}

function hasApiKey(config, provider) {
  const cfg = engineCfg(config, provider);
  const envMap = {
    openai: "OPENAI_API_KEY",
    groq: "GROQ_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const key = cfg.api_key || process.env[envMap[provider] || ""] || "";
  return Boolean(String(key).trim());
}

async function pingUrl(url, { timeoutMs = 800, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await Promise.race([
      fetch(url, { signal: ctrl.signal, headers }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    const msg = e?.message || "unreachable";
    return { ok: false, reason: /abort|timeout/i.test(msg) ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

// Same shape as pingUrl but returns the parsed JSON body when the response
// is 2xx. Used by the Ollama strict-model health check below.
async function fetchJsonWithTimeout(url, { timeoutMs = 800, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
    const json = await res.json().catch(() => null);
    return { ok: true, status: res.status, json };
  } catch (e) {
    const msg = e?.message || "unreachable";
    return { ok: false, reason: /abort|timeout/i.test(msg) ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

// Decide whether an Ollama `/api/tags` response actually has the model the
// caller is about to use. Matches first on exact `models[].name`, then on a
// permissive prefix (so `llama3` matches `llama3:latest`). Returns
// { present, available } so callers can report what's there for diagnostics.
function ollamaHasModel(tagsJson, candidateModel) {
  const list = Array.isArray(tagsJson?.models) ? tagsJson.models : [];
  const names = list.map((m) => m?.name).filter((n) => typeof n === "string");
  if (!candidateModel) return { present: true, available: names };
  const wanted = String(candidateModel).trim();
  if (!wanted) return { present: true, available: names };
  if (names.includes(wanted)) return { present: true, available: names };
  // Tolerate "foo" matching "foo:latest" / "foo:tag".
  const prefix = wanted + ":";
  if (names.some((n) => n.startsWith(prefix))) return { present: true, available: names };
  return { present: false, available: names };
}

/**
 * Check whether a provider is reachable AND, when given a candidate model,
 * whether that specific model is actually loaded. Without the candidate the
 * check stays loose (just "is the host up"); with one it's strict.
 *
 * The `candidateModel` parameter is the bare model id WITHOUT the
 * "<provider>:" prefix (e.g. "gemma4:31b-cloud", "llama-3.3-70b-versatile").
 */
export async function checkProviderHealth(provider, config, timeoutMs = 800, opts = {}) {
  const p = String(provider || "").toLowerCase();
  const candidate = opts.candidateModel || null;

  if (p === "ollama") {
    const base = (engineCfg(config, "ollama").base_url || process.env.OLLAMA_HOST || "http://localhost:11434")
      .replace(/\/$/, "");
    // Strict path: when we know which model is expected, parse /api/tags and
    // verify it's pulled. Otherwise fall back to a plain reachability ping.
    if (candidate) {
      const res = await fetchJsonWithTimeout(`${base}/api/tags`, { timeoutMs });
      if (!res.ok) {
        return { ok: false, provider: p, reason: res.reason || `HTTP ${res.status}`, detail: base };
      }
      const { present, available } = ollamaHasModel(res.json, candidate);
      if (present) {
        return { ok: true, provider: p, detail: base };
      }
      return {
        ok: false,
        provider: p,
        reason: `model "${candidate}" not loaded on this host`,
        detail: base,
        available,
      };
    }
    const res = await pingUrl(`${base}/api/tags`, { timeoutMs });
    return res.ok
      ? { ok: true, provider: p, detail: base }
      : { ok: false, provider: p, reason: res.reason || `HTTP ${res.status}`, detail: base };
  }

  if (p === "groq" || p === "openrouter" || p === "openai") {
    if (!hasApiKey(config, p)) {
      return { ok: false, provider: p, reason: "no api_key" };
    }
    const cfg = engineCfg(config, p);
    const base = (cfg.base_url || {
      groq: "https://api.groq.com/openai/v1",
      openrouter: "https://openrouter.ai/api/v1",
      openai: "https://api.openai.com/v1",
    }[p]).replace(/\/$/, "");
    const key = cfg.api_key || process.env[{ groq: "GROQ_API_KEY", openrouter: "OPENROUTER_API_KEY", openai: "OPENAI_API_KEY" }[p]] || "";
    const res = await pingUrl(`${base}/models`, {
      timeoutMs: Math.max(timeoutMs, 1200),
      headers: { authorization: `Bearer ${key}` },
    });
    if (res.ok) return { ok: true, provider: p, detail: base };
    // Key present but models ping failed — still allow attempt (some keys lack /models).
    return { ok: true, provider: p, detail: base, soft: true, reason: res.reason || `HTTP ${res.status}` };
  }

  if (p === "anthropic" || p === "gemini") {
    return hasApiKey(config, p)
      ? { ok: true, provider: p, soft: true }
      : { ok: false, provider: p, reason: "no api_key" };
  }

  if (p === "mock") {
    return { ok: true, provider: p, soft: true };
  }

  return { ok: false, provider: p, reason: "unknown provider" };
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
