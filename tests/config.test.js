// Unit tests for src/core/config.js — mergeDefaults behaviour.
// These run without touching ~/.apx since mergeDefaults is a pure function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeDefaults } from "../src/core/config.js";

// ---------------------------------------------------------------------------
// user.language
// ---------------------------------------------------------------------------

test("mergeDefaults: defaults user.language to 'en' when user key absent", () => {
  const result = mergeDefaults({});
  assert.equal(result.user.language, "en");
});

test("mergeDefaults: preserves user.language when explicitly set", () => {
  const result = mergeDefaults({ user: { language: "es" } });
  assert.equal(result.user.language, "es");
});

test("mergeDefaults: user.language 'auto' passes through unchanged", () => {
  // "auto" is a valid override; mergeDefaults must not silently strip it.
  const result = mergeDefaults({ user: { language: "auto" } });
  assert.equal(result.user.language, "auto");
});

test("mergeDefaults: user block without language inherits default 'en'", () => {
  const result = mergeDefaults({ user: {} });
  assert.equal(result.user.language, "en");
});

test("mergeDefaults: extra user fields are preserved alongside language", () => {
  const result = mergeDefaults({ user: { language: "pt", timezone: "America/Sao_Paulo" } });
  assert.equal(result.user.language, "pt");
  assert.equal(result.user.timezone, "America/Sao_Paulo");
});

// ---------------------------------------------------------------------------
// engines deep-merge
// ---------------------------------------------------------------------------

test("mergeDefaults: engines.openai.api_key is preserved", () => {
  const result = mergeDefaults({ engines: { openai: { api_key: "sk-test" } } });
  assert.equal(result.engines.openai.api_key, "sk-test");
});

test("mergeDefaults: missing engines section fills all defaults", () => {
  const result = mergeDefaults({});
  assert.ok(result.engines.anthropic);
  assert.ok(result.engines.openai);
  assert.ok(result.engines.ollama);
  assert.ok(result.engines.gemini);
});

// ---------------------------------------------------------------------------
// telegram.channels
// ---------------------------------------------------------------------------

test("mergeDefaults: telegram.channels defaults to empty array", () => {
  const result = mergeDefaults({});
  assert.deepEqual(result.telegram.channels, []);
});

test("mergeDefaults: telegram.channels is preserved when set", () => {
  const ch = [{ name: "main", bot_token: "tok", chat_id: "123" }];
  const result = mergeDefaults({ telegram: { channels: ch } });
  assert.deepEqual(result.telegram.channels, ch);
});

test("mergeDefaults: telegram.channels falls back to [] when not an array", () => {
  const result = mergeDefaults({ telegram: { channels: null } });
  assert.deepEqual(result.telegram.channels, []);
});
