import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { createLlm } from "./llm.ts";
import { ProviderError } from "./types.ts";

test("Groq ALLaM dispatches only text and refuses chats above its documented context", async () => {
  const home = tempDir("apx-allam-context-");
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
    const request = {
      models: ["groq/allam-2-7b#high"],
      messages: [{ role: "user" as const, content: "Describe", images: [{ media_id: "med_1", mime: "image/png" }] }],
      tools: [],
      signal: new AbortController().signal,
    };
    assert.equal((await llm.complete(request)).model, "groq/allam-2-7b");
    assert.equal(seen[0]?.model, "allam-2-7b");
    assert.equal(typeof seen[0]?.messages[0]?.content, "string");
    assert.match(String(seen[0]?.messages[0]?.content), /Describe/);
    await assert.rejects(
      llm.complete({ ...request, messages: [{ role: "user", content: "x".repeat(20_000) }] }),
      (error: unknown) =>
        error instanceof ProviderError && error.kind === "context" && /smaller than this chat/.test(error.message),
    );
    assert.equal(seen.length, 1, "the oversized chat never reaches the provider");
  } finally {
    await home.remove();
  }
});
