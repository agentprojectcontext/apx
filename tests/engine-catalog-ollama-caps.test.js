// A model picker is for models that can answer.
//
// Ollama's /api/tags lists every pulled model, embedding models included, and
// the catalog handed them all to the picker. Choosing one is not a degraded
// choice, it is a broken one: Ollama answers
// `"embeddinggemma:300m" does not support generate`.
//
// It happened for real, in the worst slot for it: the history compactor. A
// compaction model that cannot generate fails on every run and falls through to
// the fallback — and nobody reads a summary to check it was written, so the
// only evidence is context quietly going missing later.
//
// The Gemini branch of the same function already drops these
// (supportedGenerationMethods). Ollama just needs asking: /api/show reports
// `capabilities`.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { listModels } from "#core/engines/catalog.js";

// A fake Ollama. `caps` maps a model name to what /api/show should answer:
// an array of capabilities, "none" (an older Ollama that doesn't report them),
// or "error" (a probe that fails).
function fakeOllama(caps) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: Object.keys(caps).map((name) => ({ name })) }));
    }
    if (req.url === "/api/show") {
      let body = "";
      req.on("data", (c) => (body += c));
      return req.on("end", () => {
        const name = JSON.parse(body || "{}").model;
        seen.push(name);
        const c = caps[name];
        if (c === "error") { res.writeHead(500); return res.end("{}"); }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(c === "none" ? {} : { capabilities: c }));
      });
    }
    res.writeHead(404);
    res.end();
  });
  return { server, seen };
}

async function withFake(caps, fn) {
  const { server, seen } = fakeOllama(caps);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, seen);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("an embedding-only model never reaches the picker", async () => {
  await withFake({
    "gemma3:4b": ["completion", "vision"],
    "embeddinggemma:300m": ["embedding"],
  }, async (base) => {
    const { models } = await listModels("ollama", base);
    assert.deepEqual(models, ["gemma3:4b"],
      "an embedding model in a chat picker is a call that cannot succeed");
  });
});

test("a model that does both stays — the test is 'can it answer', not 'is it an embedder'", async () => {
  await withFake({ "hybrid:1b": ["embedding", "completion"] }, async (base) => {
    const { models } = await listModels("ollama", base);
    assert.deepEqual(models, ["hybrid:1b"]);
  });
});

test("an unreadable capability list keeps the model — fail open, always", async () => {
  // An older Ollama reports no capabilities at all, and a probe can simply
  // fail. Hiding a model the user has pulled, because OUR probe went wrong, is
  // a bug they cannot reproduce; leaving a stale entry costs them one clear
  // error at call time.
  await withFake({
    "old-server:7b": "none",
    "flaky:7b": "error",
    "embeddinggemma:300m": ["embedding"],
  }, async (base) => {
    const { models } = await listModels("ollama", base);
    assert.deepEqual(models.sort(), ["flaky:7b", "old-server:7b"]);
  });
});

test("every listed model is asked about exactly once", async () => {
  await withFake({ "a:1b": ["completion"], "b:1b": ["completion"] }, async (base, seen) => {
    await listModels("ollama", base);
    assert.deepEqual(seen.sort(), ["a:1b", "b:1b"]);
  });
});
