// Gemini key rotation.
//
// The failure this exists to stop: Google meters the free tier per KEY per
// MODEL per DAY, and the good models are metered at 20 requests a day. One key
// runs out mid-morning, every Gemini call 429s, and the chain collapses to
// whatever is last — which in this install was a free OpenRouter router that
// answers with its raw chain of thought. Five keys against the same tier is
// five times the day.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { getKeys, _resetKeyCooldowns } = await import("#core/engines/gemini.js");
const gemini = (await import("#core/engines/gemini.js")).default;

const realFetch = globalThis.fetch;

beforeEach(() => {
  _resetKeyCooldowns();
  globalThis.fetch = realFetch;
});

/** Stub fetch, recording which key each call used. */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const key = new URL(url).searchParams.get("key");
    calls.push(key);
    const { status, body } = handler(key, calls.length, url, opts);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return calls;
}

const OK_BODY = {
  candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
};
const QUOTA_BODY = { error: { status: "RESOURCE_EXHAUSTED", message: "quota exceeded" } };

const CFG = { api_key: "key-one", api_keys: ["key-two", "key-three"] };
const ask = (config = CFG, model = "gemini-3.5-flash") =>
  gemini.chat({ messages: [{ role: "user", content: "hi" }], model, config });

// --------------------------------------------------------------------------
// the key list
// --------------------------------------------------------------------------

test("api_key stays primary and api_keys is additive", () => {
  // Nothing about an existing single-key install may change.
  assert.deepEqual(getKeys(CFG), ["key-one", "key-two", "key-three"]);
  assert.deepEqual(getKeys({ api_key: "solo" }), ["solo"]);
});

test("duplicates and blanks are dropped", () => {
  const keys = getKeys({ api_key: "a", api_keys: ["a", "", "  ", "b", null] });
  assert.deepEqual(keys, ["a", "b"]);
});

test("no keys at all is an error, not a silent empty request", async () => {
  await assert.rejects(() => ask({}), /no api_key/);
});

// --------------------------------------------------------------------------
// rotation
// --------------------------------------------------------------------------

test("a working first key means no rotation at all", async () => {
  const calls = stubFetch(() => ({ status: 200, body: OK_BODY }));
  const r = await ask();
  assert.equal(r.text, "ok");
  assert.deepEqual(calls, ["key-one"], "one call, no wandering through the pool");
});

test("a key out of quota hands over to the next one", async () => {
  const calls = stubFetch((key) =>
    key === "key-one" ? { status: 429, body: QUOTA_BODY } : { status: 200, body: OK_BODY });
  const r = await ask();
  assert.equal(r.text, "ok");
  assert.deepEqual(calls, ["key-one", "key-two"]);
});

test("an exhausted key is skipped on the NEXT call, not retried every time", async () => {
  // Otherwise every turn pays a wasted round-trip for the rest of the day.
  const calls = stubFetch((key) =>
    key === "key-one" ? { status: 429, body: QUOTA_BODY } : { status: 200, body: OK_BODY });
  await ask();
  await ask();
  assert.deepEqual(calls, ["key-one", "key-two", "key-two"]);
});

test("the cooldown is per MODEL — a key dead on one tier still serves another", async () => {
  // This is the whole point of the -lite fallbacks: 20 requests a day on
  // gemini-3.5-flash, 500 on gemini-3.1-flash-lite, same key.
  const calls = stubFetch((key, _n, url) => {
    const model = url.split("/models/")[1].split(":")[0];
    return key === "key-one" && model === "gemini-3.5-flash"
      ? { status: 429, body: QUOTA_BODY }
      : { status: 200, body: OK_BODY };
  });
  await ask(CFG, "gemini-3.5-flash");          // key-one dies here
  await ask(CFG, "gemini-3.1-flash-lite");     // …but not here
  assert.deepEqual(calls, ["key-one", "key-two", "key-one"]);
});

test("every key exhausted still tries them rather than failing untried", async () => {
  // The cooldown is a guess about Google's clock. Being wrong should cost a
  // request, not the turn.
  let phase = "dead";
  const calls = stubFetch(() =>
    phase === "dead" ? { status: 429, body: QUOTA_BODY } : { status: 200, body: OK_BODY });

  await assert.rejects(() => ask(), /429|quota/);
  assert.equal(calls.length, 3, "all three were tried before giving up");

  phase = "reset"; // quota came back
  const r = await ask();
  assert.equal(r.text, "ok");
  assert.equal(calls.length, 4, "and the parked keys were tried again, not written off");
});

// --------------------------------------------------------------------------
// what must NOT rotate
// --------------------------------------------------------------------------

test("a real error fails immediately instead of repeating against every key", async () => {
  // A malformed request against three keys is one clear failure turned into
  // three slow ones.
  const calls = stubFetch(() => ({ status: 400, body: { error: { message: "bad request" } } }));
  await assert.rejects(() => ask(), /gemini 400/);
  assert.deepEqual(calls, ["key-one"]);
});

test("an invalid key is not treated as an exhausted one", async () => {
  const calls = stubFetch(() => ({ status: 403, body: { error: { message: "API key not valid" } } }));
  await assert.rejects(() => ask(), /gemini 403/);
  assert.deepEqual(calls, ["key-one"], "403 is a configuration problem, not a quota problem");
});

test("a quota error phrased without a 429 is still recognised", async () => {
  const calls = stubFetch((key) =>
    key === "key-one"
      ? { status: 400, body: { error: { status: "RESOURCE_EXHAUSTED", message: "out of quota" } } }
      : { status: 200, body: OK_BODY });
  const r = await ask();
  assert.equal(r.text, "ok");
  assert.deepEqual(calls, ["key-one", "key-two"]);
});
