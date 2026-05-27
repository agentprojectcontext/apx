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

export async function checkProviderHealth(provider, config, timeoutMs = 800) {
  const p = String(provider || "").toLowerCase();

  if (p === "ollama") {
    const base = (engineCfg(config, "ollama").base_url || process.env.OLLAMA_HOST || "http://localhost:11434")
      .replace(/\/$/, "");
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

export function modelForProvider(globalConfig, provider) {
  const sa = globalConfig?.super_agent || {};
  const fb = sa.model_fallback || {};
  const models = fb.models || {};
  const p = String(provider).toLowerCase();

  if (models[p]) return models[p];
  if (p === "ollama" && sa.model && /^ollama:/i.test(sa.model)) return sa.model;
  if (DEFAULT_FALLBACK_MODELS[p]) return DEFAULT_FALLBACK_MODELS[p];
  return "";
}

export function fallbackOrder(globalConfig) {
  const fb = globalConfig?.super_agent?.model_fallback || {};
  const order = Array.isArray(fb.order) ? fb.order.map(String) : [];
  return order.length ? order : [...DEFAULT_FALLBACK_ORDER];
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
  const order = fallbackOrder(globalConfig);
  const tried = [];

  if (isFallbackEnabled(globalConfig)) {
    for (const provider of order) {
      const modelId = modelForProvider(globalConfig, provider);
      if (!modelId) {
        tried.push({ provider, modelId: "", healthy: false, reason: "no model configured" });
        continue;
      }
      const health = await checkProviderHealth(provider, globalConfig, healthMs);
      tried.push({
        provider,
        modelId,
        healthy: health.ok,
        reason: health.reason || (health.ok ? "ok" : "unhealthy"),
        soft: health.soft,
      });
      if (health.ok) {
        const primary = sa.model || "";
        const isPrimary = modelId === primary;
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
