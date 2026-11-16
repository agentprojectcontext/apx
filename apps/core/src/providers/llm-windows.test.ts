import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { createLlm } from "./llm.ts";
import { ProviderError } from "./types.ts";

test("Groq Qwen 3.8 dispatches images above 128K and rejects chats above 131,072 tokens", async () => {
  const home = tempDir("apx-qwen-context-");
  try {
    const seen: Array<{ model: string; messages: Array<{ content: unknown }> }> = [];
    const llm = createLlm({
      firstByteMs: 1_000,
      providers: () => [
        { id: "groq", transport: "openai-chat", base_url: "https://example.com", key: "none", models: [] },
      ],
      secrets: createSecrets(home.path, "file", {}),
      media: () => ({ mime: "image/png", data: "AAAA" }),
      fetchImpl: async (_url, init) => {
        seen.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ choices: [{ message: { content: "Fits" }, finish_reason: "stop" }] }));
      },
    });
    const text = "x".repeat(516_000);
    const request = {
      models: ["groq/qwen/qwen3.8-27b"],
      messages: [{ role: "user" as const, content: text, images: [{ media_id: "med_1", mime: "image/png" }] }],
      tools: [],
      signal: new AbortController().signal,
    };
    const result = await llm.complete(request);
    assert.equal(result.model, "groq/qwen/qwen3.8-27b");
    assert.equal(seen[0]?.model, "qwen/qwen3.8-27b");
    assert.deepEqual(seen[0]?.messages[0]?.content, [
      { type: "text", text },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
    await assert.rejects(
      llm.complete({ ...request, messages: [{ role: "user", content: "x".repeat(528_000) }] }),
      (error: unknown) =>
        error instanceof ProviderError && error.kind === "context" && /smaller than this chat/.test(error.message),
    );
    assert.equal(seen.length, 1, "the oversized chat never reaches the provider");
  } finally {
    await home.remove();
  }
});

for (const model of [
  "gpt-5.6-sol",
  "gpt-6-astra",
  "gpt-6.1-terra",
  "claude-opus-4-6",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
]) {
  test(`${model} is dispatched for a chat above its former context fallback`, async () => {
    const home = tempDir("apx-context-");
    try {
      const seen: string[] = [];
      const llm = createLlm({
        firstByteMs: 1_000,
        providers: () => [
          {
            id: "acme",
            transport: "openai-chat",
            base_url: "https://example.com",
            key: "none",
            models: ["gpt-4o-mini", model],
          },
        ],
        secrets: createSecrets(home.path, "file", {}),
        fetchImpl: async (_url, init) => {
          seen.push((JSON.parse(String(init?.body)) as { model: string }).model);
          return new Response(JSON.stringify({ choices: [{ message: { content: "Fits" }, finish_reason: "stop" }] }));
        },
      });
      const out = await llm.complete({
        models: ["acme"],
        messages: [{ role: "user", content: "x".repeat(2_000_000) }],
        tools: [],
        signal: new AbortController().signal,
      });
      assert.deepEqual(seen, [model], "skip the small model, not the documented large-context model");
      assert.equal(out.model, `acme/${model}`);
      assert.equal(out.message.content, "Fits");
    } finally {
      await home.remove();
    }
  });
}
