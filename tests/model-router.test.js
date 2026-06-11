import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseModelId,
  fallbackModels,
  resolveActiveModel,
  checkProviderHealth,
} from "#core/agent/model-router.js";

test("parseModelId: groq and openrouter explicit forms", () => {
  assert.deepEqual(parseModelId("groq:llama-3.3-70b-versatile"), {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
  });
  assert.deepEqual(parseModelId("openrouter:meta-llama/llama-3.3-70b-instruct"), {
    provider: "openrouter",
    model: "meta-llama/llama-3.3-70b-instruct",
  });
});

test("fallbackModels: defaults when unset come from DEFAULT_FALLBACK_MODELS", () => {
  // The new single-list shape means defaults only include providers we have a
  // canonical model id for. Ollama needs the user's own pulled model and is
  // not a default.
  const models = fallbackModels({});
  const providers = models.map((m) => parseModelId(m).provider);
  assert.deepEqual(providers, ["openrouter", "groq"]);
});

test("resolveActiveModel: skips ollama when down, picks openrouter with key", async () => {
  const cfg = {
    super_agent: {
      model: "ollama:gemma4:31b-cloud",
      model_fallback: {
        enabled: true,
        order: ["ollama", "openrouter", "groq"],
        health_timeout_ms: 100,
        models: {
          openrouter: "openrouter:test/model",
        },
      },
    },
    engines: {
      ollama: { base_url: "http://127.0.0.1:59999" },
      openrouter: { api_key: "sk-or-test", base_url: "https://openrouter.ai/api/v1" },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("59999")) throw new Error("connection refused");
    if (String(url).includes("openrouter.ai")) {
      return { ok: true, status: 200 };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const result = await resolveActiveModel(cfg);
    assert.equal(result.modelId, "openrouter:test/model");
    assert.equal(result.fromFallback, true);
    assert.equal(result.provider, "openrouter");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Ollama strict model check (backlog item 11) ─────────────────────────────
// `/api/tags` returning 200 is no longer enough — we now verify the configured
// model is actually loaded. Otherwise the fallback chain advances.

test("checkProviderHealth(ollama) without candidate stays loose", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ models: [] }) });
  try {
    const r = await checkProviderHealth("ollama", { engines: { ollama: { base_url: "http://x:11434" } } });
    assert.equal(r.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkProviderHealth(ollama) with candidate present returns ok", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ models: [{ name: "gemma4:31b-cloud" }, { name: "llama3:latest" }] }),
  });
  try {
    const r = await checkProviderHealth(
      "ollama",
      { engines: { ollama: { base_url: "http://x:11434" } } },
      800,
      { candidateModel: "gemma4:31b-cloud" }
    );
    assert.equal(r.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkProviderHealth(ollama) with candidate missing returns ok:false + available list", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ models: [{ name: "llama3:latest" }, { name: "mistral:7b" }] }),
  });
  try {
    const r = await checkProviderHealth(
      "ollama",
      { engines: { ollama: { base_url: "http://x:11434" } } },
      800,
      { candidateModel: "gemma4:31b-cloud" }
    );
    assert.equal(r.ok, false);
    assert.match(r.reason, /not loaded/);
    assert.deepEqual(r.available, ["llama3:latest", "mistral:7b"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkProviderHealth(ollama) accepts bare 'foo' matching 'foo:tag'", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ models: [{ name: "qwen3:32b" }] }),
  });
  try {
    const r = await checkProviderHealth(
      "ollama",
      { engines: { ollama: { base_url: "http://x:11434" } } },
      800,
      { candidateModel: "qwen3" }
    );
    assert.equal(r.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveActiveModel skips Ollama when its configured model isn't pulled", async () => {
  const cfg = {
    super_agent: {
      model: "ollama:gemma4:31b-cloud",
      model_fallback: {
        enabled: true,
        order: ["ollama", "openrouter"],
        models: { openrouter: "openrouter:openrouter/free" },
        health_timeout_ms: 200,
      },
    },
    engines: {
      ollama: { base_url: "http://localhost:11434" },
      openrouter: { api_key: "test", base_url: "https://openrouter.ai/api/v1" },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes("/api/tags")) {
      // Ollama is reachable but doesn't have gemma4 — only llama3.
      return { ok: true, status: 200, json: async () => ({ models: [{ name: "llama3:latest" }] }) };
    }
    if (s.includes("openrouter.ai")) {
      return { ok: true, status: 200 };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const result = await resolveActiveModel(cfg);
    assert.equal(result.modelId, "openrouter:openrouter/free");
    assert.equal(result.fromFallback, true);
    const ollamaTry = result.tried.find((t) => t.provider === "ollama");
    assert.equal(ollamaTry.healthy, false);
    assert.match(ollamaTry.reason, /not loaded/);
    assert.deepEqual(ollamaTry.available, ["llama3:latest"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── New flat-list format + legacy migration ─────────────────────────────────

test("fallbackModels: reads the new array shape directly", async () => {
  const { fallbackModels } = await import("#core/agent/model-router.js");
  const cfg = {
    super_agent: {
      model_fallback: {
        models: ["openrouter:openrouter/free", "groq:qwen/qwen3-32b"],
      },
    },
  };
  assert.deepEqual(fallbackModels(cfg), [
    "openrouter:openrouter/free",
    "groq:qwen/qwen3-32b",
  ]);
});

test("fallbackModels: array order IS attempt order (no separate `order` needed)", async () => {
  const { fallbackModels } = await import("#core/agent/model-router.js");
  const cfg = {
    super_agent: {
      model_fallback: {
        models: ["groq:qwen3", "openrouter:free", "ollama:llama3"],
      },
    },
  };
  assert.deepEqual(fallbackModels(cfg), [
    "groq:qwen3",
    "openrouter:free",
    "ollama:llama3",
  ]);
});

test("fallbackModels: legacy { order, models{} } shape is normalised in order", async () => {
  const { fallbackModels } = await import("#core/agent/model-router.js");
  const cfg = {
    super_agent: {
      model: "ollama:gemma4:31b",   // ollama gets a fallback to primary
      model_fallback: {
        order: ["ollama", "groq", "openrouter"],
        models: {
          openrouter: "openrouter:openrouter/free",
          groq: "groq:qwen/qwen3-32b",
        },
      },
    },
  };
  assert.deepEqual(fallbackModels(cfg), [
    "ollama:gemma4:31b",
    "groq:qwen/qwen3-32b",
    "openrouter:openrouter/free",
  ]);
});

test("fallbackModels: drops malformed entries (no provider prefix)", async () => {
  const { fallbackModels } = await import("#core/agent/model-router.js");
  const cfg = {
    super_agent: {
      model_fallback: {
        models: ["openrouter:ok", 42, null, "bad-no-colon", "groq:also-ok"],
      },
    },
  };
  assert.deepEqual(fallbackModels(cfg), ["openrouter:ok", "groq:also-ok"]);
});

test("resolveActiveModel: walks the array in order, primary first then fallback", async () => {
  const cfg = {
    super_agent: {
      model: "ollama:gemma4:31b-cloud",
      model_fallback: {
        enabled: true,
        models: ["openrouter:openrouter/free", "groq:qwen/qwen3-32b"],
        health_timeout_ms: 200,
      },
    },
    engines: {
      ollama: { base_url: "http://localhost:11434" },
      openrouter: { api_key: "test", base_url: "https://openrouter.ai/api/v1" },
      groq: { api_key: "test", base_url: "https://api.groq.com/openai/v1" },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes("/api/tags")) {
      // Ollama up but doesn't have gemma4 (strict check trips).
      return { ok: true, status: 200, json: async () => ({ models: [{ name: "llama3:latest" }] }) };
    }
    if (s.includes("openrouter.ai")) return { ok: true, status: 200 };
    if (s.includes("api.groq.com"))  return { ok: true, status: 200 };
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const result = await resolveActiveModel(cfg);
    assert.equal(result.modelId, "openrouter:openrouter/free");
    assert.equal(result.fromFallback, true);
    // tried order: primary first, then array order.
    assert.equal(result.tried[0].modelId, "ollama:gemma4:31b-cloud");
    assert.equal(result.tried[0].healthy, false);
    assert.equal(result.tried[1].modelId, "openrouter:openrouter/free");
    assert.equal(result.tried[1].healthy, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Lazy retry: isRetryableEngineError classifier ───────────────────────────

test("isRetryableEngineError: 429 / 413 / 5xx → retry", async () => {
  const { isRetryableEngineError } = await import("#core/agent/retry.js");
  assert.equal(isRetryableEngineError(new Error("groq 429: Rate limit reached")), true);
  assert.equal(isRetryableEngineError(new Error("groq 413: Request too large for model")), true);
  assert.equal(isRetryableEngineError(new Error("anthropic 529: overloaded")), true);
  assert.equal(isRetryableEngineError(new Error("ollama 500: Internal server error")), true);
  assert.equal(isRetryableEngineError(new Error("openrouter 502: bad gateway")), true);
});

test("isRetryableEngineError: auth / not-found / malformed → fatal", async () => {
  const { isRetryableEngineError } = await import("#core/agent/retry.js");
  assert.equal(isRetryableEngineError(new Error("openai 401: unauthorized")), false);
  assert.equal(isRetryableEngineError(new Error("groq 403: forbidden")), false);
  assert.equal(isRetryableEngineError(new Error("groq 400: 'tools.0.type' is missing")), false);
  assert.equal(isRetryableEngineError(new Error("openai: no api_key")), false);
});

test("isRetryableEngineError: 400 'failed to call a function' → retry (model issue)", async () => {
  const { isRetryableEngineError } = await import("#core/agent/retry.js");
  assert.equal(
    isRetryableEngineError(new Error("groq 400: Failed to call a function. Please adjust your prompt.")),
    true
  );
});

test("isRetryableEngineError: phrase fallback when no status code", async () => {
  const { isRetryableEngineError } = await import("#core/agent/retry.js");
  assert.equal(isRetryableEngineError(new Error("connection reset by peer")), true);
  assert.equal(isRetryableEngineError(new Error("upstream timeout")), true);
  assert.equal(isRetryableEngineError(new Error("absolutely nothing wrong here")), false);
});
