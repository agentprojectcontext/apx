import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { createLlm } from "./llm.ts";
import { ProviderError } from "./types.ts";

for (const { provider, model, count } of [
  { provider: "groq", model: "qwen/qwen3.8-27b", count: 3 },
  { provider: "groq", model: "qwen/qwen3.8-27b", count: 4 },
  { provider: "cerebras", model: "qwen-3.8-27b", count: 4 },
]) {
  test(`${provider} Qwen 3.8 uses only its documented image cap: ${count} attached`, async () => {
    const home = tempDir("apx-qwen-images-");
    try {
      const calls: string[] = [];
      const llm = createLlm({
        providers: () => [
          { id: provider, transport: "openai-chat", base_url: "https://example.com", key: "none", models: [] },
        ],
        secrets: createSecrets(home.path, "file", {}),
        firstByteMs: 1_000,
        media: () => ({ mime: "image/png", data: "AAAA" }),
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          calls.push(body.model);
          const parts = body.messages.flatMap((m: { content: unknown }) => (Array.isArray(m.content) ? m.content : []));
          assert.equal(parts.filter((p: { type: string }) => p.type === "image_url").length, count);
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Images received" }, finish_reason: "stop" }] }),
          );
        },
      });
      const request = {
        models: [`${provider}/${model}`],
        messages: [
          {
            role: "user" as const,
            content: "Compare these pictures",
            images: Array.from({ length: count }, (_, i) => ({ media_id: `med_${i}`, mime: "image/png" })),
          },
        ],
        tools: [],
        signal: new AbortController().signal,
      };
      if (count === 3 || provider === "cerebras") {
        assert.equal((await llm.complete(request)).model, `${provider}/${model}`);
        assert.deepEqual(calls, [model]);
      } else {
        await assert.rejects(
          llm.complete(request),
          (error: unknown) =>
            error instanceof ProviderError && error.kind === "bad_request" && /at most 3 images/.test(error.message),
        );
        assert.deepEqual(calls, [], "never send an invalid request or silently remove an image");
        assert.equal(
          (await llm.complete({ ...request, models: [...request.models, "groq/llama-4-scout"] })).model,
          "groq/llama-4-scout",
        );
        assert.deepEqual(calls, ["llama-4-scout"], "the next visual model receives all four images");
      }
    } finally {
      await home.remove();
    }
  });
}
