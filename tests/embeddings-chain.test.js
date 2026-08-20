// The embeddings chain must fall through to the NEXT engine on a runtime failure
// (a rate-limited 429 or a down host), not drop straight to the offline tf floor.
// That is what lets a working local Ollama pick up after a quota-exhausted Gemini.
import { test } from "node:test";
import assert from "node:assert/strict";
import { embedderProvider, embedOne } from "#core/memory/embeddings.js";
import { selectEmbedChain } from "#core/memory/embed-engines/index.js";

test("embedderProvider — strips the model off the embedder tag", () => {
  assert.equal(embedderProvider("ollama:nomic-embed-text"), "ollama");
  assert.equal(embedderProvider("gemini:text-embedding-004"), "gemini");
  assert.equal(embedderProvider("tf"), "tf");
  assert.equal(embedderProvider(""), "tf");
  assert.equal(embedderProvider(undefined), "tf");
});

test("selectEmbedChain — keyless providers are skipped, Ollama (local) stays", async () => {
  // No API keys anywhere → gemini/openai fail isAvailable and drop out; ollama's
  // adapter reports available without a network probe (embed falls back on error).
  const chain = await selectEmbedChain({ globalConfig: { memory: { embeddings: { mode: "chain" } }, engines: {} } });
  const ids = chain.map((c) => c.provider);
  assert.ok(ids.includes("ollama"), `expected ollama in chain, got ${JSON.stringify(ids)}`);
  assert.ok(!ids.includes("gemini"), "keyless gemini must be excluded");
  assert.ok(!ids.includes("openai"), "keyless openai must be excluded");
  assert.ok(!ids.includes("tf"), "tf is the embedOne floor, never in the chain");
});

test("selectEmbedChain — a disabled engine is dropped even with a key", async () => {
  const cfg = {
    memory: { embeddings: { mode: "chain", gemini: { enabled: false } } },
    engines: { gemini: { api_key: "AIzaTESTKEY" } },
  };
  const ids = (await selectEmbedChain({ globalConfig: cfg })).map((c) => c.provider);
  assert.ok(!ids.includes("gemini"), "gemini turned off must not be in the chain");
});

test("selectEmbedChain — single mode returns exactly the chosen provider", async () => {
  const cfg = { memory: { embeddings: { mode: "single", provider: "openai" } }, engines: {} };
  const ids = (await selectEmbedChain({ globalConfig: cfg })).map((c) => c.provider);
  assert.deepEqual(ids, ["openai"]);
});

test("embedOne — empty text is the offline tf vector, never a provider call", async () => {
  const out = await embedOne("", { globalConfig: {} });
  assert.equal(out.embedder, "tf");
  assert.ok(Array.isArray(out.vector) && out.vector.length > 0);
});
