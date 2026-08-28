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
  redactConfig, mergeRedactedSecrets, isSecretMarker, secretMarker, SECRET_PATHS, isSecretKey,
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

// ---------------------------------------------------------------------------
// isSecretKey — the write-side question ("is this key a credential?"), asked of
// the same SECRET_PATHS inventory the read-side redaction uses. `apx config
// set` calls it to warn before a credential lands in a committed
// .apc/config.json.
// ---------------------------------------------------------------------------

test("isSecretKey matches an exact secret path", () => {
  for (const dotted of SECRET_PATHS) {
    if (dotted.includes("*")) continue;
    assert.equal(isSecretKey(dotted), true, dotted);
  }
});

test("isSecretKey matches wildcard paths that dotted keys cannot express", () => {
  // Bot tokens and spare Gemini keys live in arrays; a concrete index must
  // still register as secret.
  assert.equal(isSecretKey("telegram.channels.0.bot_token"), true);
  assert.equal(isSecretKey("engines.gemini.api_keys.1"), true);
});

test("isSecretKey matches an ancestor, because the secret rides in the value", () => {
  assert.equal(isSecretKey("engines.openai"), true);
  assert.equal(isSecretKey("engines"), true);
  assert.equal(isSecretKey("voice.tts.elevenlabs"), true);
});

test("isSecretKey catches a provider added after SECRET_PATHS was last touched", () => {
  assert.equal(isSecretKey("engines.newprovider.api_key"), true);
  assert.equal(isSecretKey("integrations.acme.access_token"), true);
  assert.equal(isSecretKey("something.client_secret"), true);
});

test("isSecretKey leaves ordinary project-overridable keys alone", () => {
  // These are exactly the keys the docs tell people to put in .apc/config.json.
  for (const key of [
    "super_agent.model",
    "super_agent.permission_mode",
    "telegram.route_to_agent",
    "engines.openai.model",
    "engines.ollama.base_url",
    "voice.tts.provider",
  ]) {
    assert.equal(isSecretKey(key), false, key);
  }
});

test("isSecretKey handles junk input without throwing", () => {
  assert.equal(isSecretKey(""), false);
  assert.equal(isSecretKey("   "), false);
  assert.equal(isSecretKey(undefined), false);
  assert.equal(isSecretKey(null), false);
  assert.equal(isSecretKey(42), false);
});

// ---------------------------------------------------------------------------
// User-added providers live in an object keyed by slug, so their secret path
// has a WILDCARD in the middle (`voice.tts.custom.*.api_key`). redactConfig
// used to skip every wildcard pattern outright, which meant a custom TTS
// endpoint's key was served in clear text to anyone who opened Settings — the
// exact failure the spare-Gemini-keys case above was written for, in a
// different shape. Image providers (images.custom.*) are keyed the same way.
// ---------------------------------------------------------------------------

const WITH_CUSTOM = {
  voice: { tts: { custom: {
    qvox: { label: "QVox", base_url: "http://localhost:5111/v1", api_key: "tok-voice-11111" },
    other: { base_url: "http://localhost:5112/v1" },
  } } },
  images: { custom: {
    box: { label: "Homelab", kind: "sdcpp", base_url: "http://example.test:8189", api_key: "tok-image-22222" },
  } },
};

test("a custom provider's key is redacted, not served in clear text", () => {
  const red = redactConfig(WITH_CUSTOM);
  assert.ok(isSecretMarker(red.voice.tts.custom.qvox.api_key));
  assert.ok(isSecretMarker(red.images.custom.box.api_key));
  // Non-secret fields on the same object are untouched.
  assert.equal(red.voice.tts.custom.qvox.base_url, "http://localhost:5111/v1");
  assert.equal(red.images.custom.box.kind, "sdcpp");
  // A provider with no key gains none.
  assert.equal(red.voice.tts.custom.other.api_key, undefined);
});

test("saving the redacted view back keeps a custom provider's real key", () => {
  const merged = mergeRedactedSecrets(redactConfig(WITH_CUSTOM), WITH_CUSTOM);
  assert.equal(merged.voice.tts.custom.qvox.api_key, "tok-voice-11111");
  assert.equal(merged.images.custom.box.api_key, "tok-image-22222");
});

test("the built-in image engines are declared secret paths", () => {
  for (const p of ["images.a1111.api_key", "images.sdcpp.api_key", "images.openai.api_key"]) {
    assert.ok(SECRET_PATHS.includes(p), p);
    assert.equal(isSecretKey(p), true);
  }
  // …and their non-secret siblings are not.
  assert.equal(isSecretKey("images.a1111.base_url"), false);
  assert.equal(isSecretKey("images.provider"), false);
});
