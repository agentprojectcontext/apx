// A cold Ollama embedder takes seconds to load and the per-turn memory budget
// is well under that, so the first message after a five-minute pause recalled
// nothing. The embed request now asks Ollama to keep the model loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
// Through embeddings.js, as the daemon loads it (the adapter imports it back).
await import("#core/memory/embeddings.js");
const { default: ollama } = await import("#core/memory/embed-engines/ollama.js");

test("ollama embeddings ask for the model to stay loaded", async () => {
  const sent = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ embedding: [0.1, 0.2, 0.3] }) };
  };
  try {
    await ollama.embed({ text: "hola", config: { base_url: "http://127.0.0.1:1" } });
    await ollama.embed({ text: "hola", config: { base_url: "http://127.0.0.1:1", keep_alive: "10m" } });
  } finally {
    globalThis.fetch = prev;
  }
  assert.equal(sent[0].keep_alive, "2h");
  assert.equal(sent[1].keep_alive, "10m", "config wins");
});
