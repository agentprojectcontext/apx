// Secret redaction for the global config.
//
// The list of spare Gemini keys (quota rotation) is an ARRAY, and dotted paths
// cannot reach into arrays — the same blind spot that already required special
// handling for Telegram bot tokens. Getting this wrong has two distinct and
// both-bad outcomes, so both are pinned here:
//
//   1. Reading: every spare key served in clear text to anyone who opens
//      Settings → Engines.
//   2. Writing: opening that screen and pressing Save writes the redaction
//      MARKERS over the real keys, silently emptying the rotation pool.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redactConfig, mergeRedactedSecrets, isSecretMarker, secretMarker, SECRET_PATHS,
} from "#core/config/redact.js";

const REAL = {
  engines: {
    gemini: { api_key: "AIzaPRIMARYxxxxxxxxxxxxxxxxxxx1", api_keys: ["AIzaSPAREaaaaaaaaaaaaaaaaaaa2", "AIzaSPAREbbbbbbbbbbbbbbbbbbb3"] },
    groq: { api_key: "gsk_realgroqkeyvalue000000000" },
  },
};

test("the primary key and every spare are redacted", () => {
  const out = redactConfig(REAL);
  assert.ok(isSecretMarker(out.engines.gemini.api_key));
  assert.equal(out.engines.gemini.api_keys.length, 2);
  for (const k of out.engines.gemini.api_keys) {
    assert.ok(isSecretMarker(k), "a spare key must never leave the daemon in clear text");
  }
});

test("no real key material survives into the redacted view", () => {
  const serialised = JSON.stringify(redactConfig(REAL));
  for (const secret of [REAL.engines.gemini.api_key, ...REAL.engines.gemini.api_keys]) {
    assert.ok(!serialised.includes(secret), "a full key reached the panel payload");
  }
});

test("markers keep the tail so a human can tell the keys apart", () => {
  const out = redactConfig(REAL);
  assert.match(out.engines.gemini.api_keys[0], /\.\.\.aaaa2\)$/);
  assert.match(out.engines.gemini.api_keys[1], /\.\.\.bbbb3\)$/);
});

test("saving the redacted view back does not wipe the pool", () => {
  // The exact round-trip the panel performs.
  const fromPanel = JSON.parse(JSON.stringify(redactConfig(REAL)));
  const merged = mergeRedactedSecrets(fromPanel, REAL);
  assert.equal(merged.engines.gemini.api_key, REAL.engines.gemini.api_key);
  assert.deepEqual(merged.engines.gemini.api_keys, REAL.engines.gemini.api_keys);
});

test("a genuinely new spare key replaces the old one at that position", () => {
  const fromPanel = JSON.parse(JSON.stringify(redactConfig(REAL)));
  fromPanel.engines.gemini.api_keys[1] = "AIzaBRANDNEWkeyvalue00000000";
  const merged = mergeRedactedSecrets(fromPanel, REAL);
  assert.equal(merged.engines.gemini.api_keys[0], REAL.engines.gemini.api_keys[0], "untouched one restored");
  assert.equal(merged.engines.gemini.api_keys[1], "AIzaBRANDNEWkeyvalue00000000", "edited one honoured");
});

test("removing a spare key removes it, rather than being restored", () => {
  const fromPanel = JSON.parse(JSON.stringify(redactConfig(REAL)));
  fromPanel.engines.gemini.api_keys = [fromPanel.engines.gemini.api_keys[0]];
  const merged = mergeRedactedSecrets(fromPanel, REAL);
  assert.equal(merged.engines.gemini.api_keys.length, 1);
  assert.equal(merged.engines.gemini.api_keys[0], REAL.engines.gemini.api_keys[0]);
});

test("an absent list stays absent — no empty array invented", () => {
  const out = redactConfig({ engines: { gemini: { api_key: "AIzaonlyprimary000000000000" } } });
  assert.equal(out.engines.gemini.api_keys, undefined);
});

test("the spare list is declared in SECRET_PATHS so the inventory is complete", () => {
  // The file's own header calls SECRET_PATHS the single source of truth for
  // "which keys are secrets". A secret handled only by special-case code and
  // absent from the list is one the next person will not know exists.
  assert.ok(SECRET_PATHS.includes("engines.gemini.api_keys.*"));
});

test("other engines are unaffected", () => {
  const out = redactConfig(REAL);
  assert.ok(isSecretMarker(out.engines.groq.api_key));
  assert.equal(secretMarker(""), "", "an empty secret stays empty rather than becoming a marker");
});
