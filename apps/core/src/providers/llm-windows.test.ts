import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { createLlm } from "./llm.ts";

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
