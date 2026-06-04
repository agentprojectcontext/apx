import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatibleEngine } from "../src/core/engines/openai-compatible.js";

test("openai-compatible: uses config.base_url override", async () => {
  const engine = createOpenAiCompatibleEngine({
    id: "test",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "TEST_OPENAI_KEY",
  });

  let calledUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    };
  };

  try {
    process.env.TEST_OPENAI_KEY = "test-key";
    await engine.chat({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "ping" }],
      config: { api_key: "test-key", base_url: "https://api.groq.com/openai/v1" },
    });
    assert.equal(calledUrl, "https://api.groq.com/openai/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_OPENAI_KEY;
  }
});
