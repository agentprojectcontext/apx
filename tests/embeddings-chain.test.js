// The embeddings chain must fall through to the NEXT engine on a runtime failure
// (a rate-limited 429 or a down host), not drop straight to the offline tf floor.
// That is what lets a working local Ollama pick up after a quota-exhausted Gemini.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { embedderProvider, embedOne, DEFAULT_EMBED_TIMEOUT_MS } from "#core/memory/embeddings.js";
import {
  selectEmbedChain,
  getEmbedAdapter,
  resolveChainOrder,
  isCustomId,
} from "#core/memory/embed-engines/index.js";

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

// ── Custom OpenAI-compatible providers ──────────────────────────────────────

test("isCustomId / getEmbedAdapter — custom:<slug> resolves to the custom adapter", () => {
  assert.equal(isCustomId("custom:zen"), true);
  assert.equal(isCustomId("ollama"), false);
  const a = getEmbedAdapter("custom:zen");
  assert.ok(a && typeof a.embed === "function", "custom id must resolve to an adapter");
});

test("selectEmbedChain — a custom provider with base_url joins the chain, tagged with its own id", async () => {
  const cfg = {
    memory: { embeddings: { mode: "chain", custom: {
      zen: { base_url: "http://localhost:9000/v1", model: "bge-m3" },
      empty: { base_url: "" },
    } } },
    engines: {},
  };
  const chain = await selectEmbedChain({ globalConfig: cfg });
  const ids = chain.map((c) => c.provider);
  assert.ok(ids.includes("custom:zen"), `expected custom:zen, got ${JSON.stringify(ids)}`);
  assert.ok(!ids.includes("custom:empty"), "a custom provider without base_url is unavailable");
  const zen = chain.find((c) => c.provider === "custom:zen");
  assert.equal(zen.engineConfig._embedder_id, "custom:zen", "adapter must tag vectors with the provider id");
});

test("selectEmbedChain — a disabled custom provider is dropped", async () => {
  const cfg = {
    memory: { embeddings: { mode: "chain", custom: { zen: { base_url: "http://x/v1", enabled: false } } } },
    engines: {},
  };
  const ids = (await selectEmbedChain({ globalConfig: cfg })).map((c) => c.provider);
  assert.ok(!ids.includes("custom:zen"), "an off custom provider must not be in the chain");
});

test("resolveChainOrder — custom providers are reorderable and tf stays last", () => {
  const order = resolveChainOrder({ mode: "chain", custom: { zen: { base_url: "http://x/v1" } } });
  assert.ok(order.includes("custom:zen"), "custom provider must appear in the order");
  assert.equal(order[order.length - 1], "tf");
});

// A timeout shorter than a cold model load can never succeed, and its failure
// mode is invisible: the chain falls through to the offline `tf` floor, the
// call never completes so the model never warms up, and the next call times out
// the same way. A live install sat in bag-of-words mode indefinitely because a
// 4s default was measured against a ~6s cold load, with a perfectly good local
// embedder one hop away.
test("the default embed timeout leaves room for a cold model load", () => {
  assert.ok(
    DEFAULT_EMBED_TIMEOUT_MS >= 15_000,
    `a cold Ollama embedding model takes ~6s to load; ${DEFAULT_EMBED_TIMEOUT_MS}ms cannot cover it`,
  );
});

test("embedOne: a slow-but-alive engine is waited for; an explicit timeout still wins", async () => {
  // Asserted against the CALL's own progress, not against a clock. The first
  // version of this test slept 250ms in the handler, cut the second call at
  // 30ms, and then demanded that both requests had reached the server — three
  // wall-time bets that only hold on an idle machine. Under a full `preflight`
  // the 30ms abort can fire before the socket is even connected, so the server
  // never sees the second request and the test fails on perfectly good code,
  // which teaches everyone to re-run it instead of reading it.
  //
  // So nothing here sleeps: the fake engine answers only when the TEST releases
  // it. "Slow" means "has not answered yet", which is what the chain is really
  // being asked about, and the whole story is an ordered list of facts.
  const events = [];
  let received = 0;
  const stray = [];
  let handOverSlowRequest;
  const slowRequest = new Promise((resolve) => { handOverSlowRequest = resolve; });

  const server = http.createServer((req, res) => {
    // Only the first request is part of the story. Whether the short-timeout
    // call's socket ever reaches this handler before its own abort IS the race
    // this test used to lose, so nothing below depends on it.
    if (++received === 1) {
      events.push("engine received the slow request");
      handOverSlowRequest(res);
    } else {
      stray.push(res);
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base_url = `http://127.0.0.1:${server.address().port}`;
  const cfgWith = (extra) => ({
    memory: { embeddings: { provider: "ollama", mode: "single", ollama: { model: "m", base_url, ...extra } } },
  });

  try {
    // No timeout_ms → the generous default. The call is left in flight with its
    // request sitting unanswered on the server.
    const slow = embedOne("una imagen de un zorro", { globalConfig: cfgWith({}) });
    slow.then((r) => events.push(`slow call resolved: ${r.embedder}`));
    const slowRes = await slowRequest;

    // An explicit timeout_ms is still honoured — the default is a floor under
    // the engine, not a ceiling over the config. tf can only come from the call
    // being cut short here: the engine is reachable (it is holding a request
    // open) and it is in the chain, which is the half of the old `calls === 2`
    // assertion that can be checked without racing a stopwatch.
    const chain = await selectEmbedChain({ globalConfig: cfgWith({ timeout_ms: 1 }) });
    assert.deepEqual(chain.map((c) => c.provider), ["ollama"], "the short call had a real engine to cut");
    const cut = await embedOne("una imagen de un zorro", { globalConfig: cfgWith({ timeout_ms: 1 }) });
    events.push(`short call gave up: ${cut.embedder}`);
    assert.equal(cut.embedder, "tf", "an explicit timeout_ms must still be able to cut a call short");

    // The order is the point: the short call has already given up while the
    // generous one is still waiting on an engine that has not said a word.
    assert.ok(
      !events.some((e) => e.startsWith("slow call resolved")),
      `the generous call must still be waiting, got ${JSON.stringify(events)}`,
    );

    // The engine answers at last — late, but alive — and beats the tf floor.
    events.push("test answered the slow request");
    slowRes.writeHead(200, { "content-type": "application/json" });
    slowRes.end(JSON.stringify({ embedding: [3, 4, 0] }));
    const ok = await slow;
    assert.equal(ok.embedder, "ollama:m", "a slow engine that ANSWERS must beat the tf floor");
    assert.equal(ok.dim, 3);

    assert.deepEqual(events, [
      "engine received the slow request",
      "short call gave up: tf",
      "test answered the slow request",
      "slow call resolved: ollama:m",
    ]);
  } finally {
    for (const res of stray) res.destroy();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
