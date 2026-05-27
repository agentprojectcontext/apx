import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseModelId,
  modelForProvider,
  fallbackOrder,
  resolveActiveModel,
} from "../src/core/agent/model-router.js";

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

test("modelForProvider: ollama uses super_agent.model", () => {
  const cfg = { super_agent: { model: "ollama:gemma4:31b-cloud" } };
  assert.equal(modelForProvider(cfg, "ollama"), "ollama:gemma4:31b-cloud");
});

test("fallbackOrder: defaults when unset", () => {
  assert.deepEqual(fallbackOrder({}), ["ollama", "openrouter", "groq"]);
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
