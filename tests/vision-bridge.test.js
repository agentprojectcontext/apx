// Vision bridge + OpenAI multimodal wire — photos must reach text-only models
// (zen:big-pickle) as a description, and vision models as real image parts.
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  providerWiresVision,
  visionBridgeModel,
  withImageDescription,
} = await import("#core/agent/vision-bridge.js");
const { messagesForModel } = await import("#core/agent/model-capabilities.js");

test("providerWiresVision: gemini/openai/anthropic/openrouter yes, zen no", () => {
  assert.equal(providerWiresVision("gemini:gemini-2.0-flash"), true);
  assert.equal(providerWiresVision("openai:gpt-4o"), true);
  assert.equal(providerWiresVision("anthropic:claude-haiku-4-5"), true);
  assert.equal(providerWiresVision("openrouter:google/gemini-flash"), true);
  assert.equal(providerWiresVision("zen:big-pickle"), false);
  assert.equal(providerWiresVision("groq:llama-3.3"), false);
  assert.equal(
    providerWiresVision("private:gpt-vision", { engines: { private: { engine: "openai" } } }),
    true,
  );
});

test("messagesForModel removes raw images from text-only fallback without mutating history", () => {
  const original = [{
    role: "user",
    content: "mirá esto",
    images: [{ mime: "image/jpeg", data: "secret-base64", path: "/tmp/photo.jpg" }],
  }];
  const degraded = messagesForModel(original, "zen:big-pickle");

  assert.notEqual(degraded, original);
  assert.equal(degraded[0].images, undefined);
  assert.match(degraded[0].content, /\[imagen adjunta: \/tmp\/photo\.jpg\]/);
  assert.doesNotMatch(degraded[0].content, /secret-base64/);
  assert.equal(original[0].images[0].data, "secret-base64", "vision fallback still gets original pixels");
  assert.equal(messagesForModel(original, "gemini:gemini-2.0-flash"), original);
});

test("visionBridgeModel: config override, then has_image rule, then default", () => {
  assert.equal(
    visionBridgeModel({ super_agent: { vision_bridge_model: "openai:gpt-4o" } }),
    "openai:gpt-4o",
  );
  assert.equal(
    visionBridgeModel({
      super_agent: {
        routing: { rules: [{ model: "gemini:gemini-2.0-flash", when: { has_image: true } }] },
      },
    }),
    "gemini:gemini-2.0-flash",
  );
  assert.equal(visionBridgeModel({}), "gemini:gemini-2.0-flash");
});

test("withImageDescription folds a block the text model can read", () => {
  const out = withImageDescription("ahí va", "A woman in a black outfit at the gym.");
  assert.match(out, /ahí va/);
  assert.match(out, /Attached photo/);
  assert.match(out, /woman in a black outfit/);
});

test("openai-compatible: user images become multimodal image_url parts", async () => {
  const { createOpenAiCompatibleEngine } = await import("#core/engines/openai-compatible.js");
  const engine = createOpenAiCompatibleEngine({
    id: "test",
    defaultBaseUrl: "https://example.test/v1",
    apiKeyEnv: "TEST_VISION_KEY",
  });

  let body = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "saw it" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    };
  };

  try {
    process.env.TEST_VISION_KEY = "k";
    await engine.chat({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: "what is this?",
        images: [{ mime: "image/jpeg", data: "abc123" }],
      }],
      config: { api_key: "k" },
    });
    const content = body.messages.find((m) => m.role === "user").content;
    assert.ok(Array.isArray(content), "multimodal content must be an array");
    assert.equal(content[0].type, "text");
    assert.equal(content[1].type, "image_url");
    assert.match(content[1].image_url.url, /^data:image\/jpeg;base64,abc123$/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_VISION_KEY;
  }
});
