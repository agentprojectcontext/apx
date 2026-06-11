// Unit tests for src/core/config/index.js — mergeDefaults behaviour.
// These run without touching ~/.apx since mergeDefaults is a pure function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeDefaults } from "#core/config/index.js";

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

// ---------------------------------------------------------------------------
// telegram legacy migration (bot_token / chat_id at root level)
// ---------------------------------------------------------------------------

// Silence the migration warning during tests; restore after each case.
function silenceWarn(fn) {
  const orig = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = orig;
  }
}

test("mergeDefaults: fresh telegram config has no legacy bot_token/chat_id at root", () => {
  const result = mergeDefaults({});
  assert.equal(result.telegram.bot_token, undefined);
  assert.equal(result.telegram.chat_id, undefined);
  assert.deepEqual(result.telegram.channels, []);
});

test("mergeDefaults: new-style telegram config (channels only) is preserved as-is", () => {
  const channels = [{ name: "main", bot_token: "tok-new", chat_id: "999" }];
  const result = silenceWarn(() =>
    mergeDefaults({
      telegram: {
        enabled: true,
        poll_interval_ms: 2000,
        channels,
      },
    }),
  );
  assert.equal(result.telegram.enabled, true);
  assert.equal(result.telegram.poll_interval_ms, 2000);
  assert.deepEqual(result.telegram.channels, channels);
  assert.equal(result.telegram.bot_token, undefined);
  assert.equal(result.telegram.chat_id, undefined);
});

test("mergeDefaults: legacy telegram.bot_token/chat_id migrates into channels[0]", () => {
  const result = silenceWarn(() =>
    mergeDefaults({
      telegram: {
        enabled: true,
        bot_token: "legacy-token",
        chat_id: "legacy-chat",
      },
    }),
  );
  assert.equal(result.telegram.channels.length, 1);
  assert.equal(result.telegram.channels[0].name, "default");
  assert.equal(result.telegram.channels[0].bot_token, "legacy-token");
  assert.equal(result.telegram.channels[0].chat_id, "legacy-chat");
  // legacy root fields are dropped after migration
  assert.equal(result.telegram.bot_token, undefined);
  assert.equal(result.telegram.chat_id, undefined);
});

test("mergeDefaults: legacy fields are ignored when channels[] already has entries", () => {
  const channels = [{ name: "main", bot_token: "real-tok", chat_id: "real-chat" }];
  const result = silenceWarn(() =>
    mergeDefaults({
      telegram: {
        enabled: true,
        bot_token: "legacy-token",
        chat_id: "legacy-chat",
        channels,
      },
    }),
  );
  // channels wins; legacy is silently dropped, not merged in.
  assert.equal(result.telegram.channels.length, 1);
  assert.deepEqual(result.telegram.channels, channels);
  assert.equal(result.telegram.bot_token, undefined);
  assert.equal(result.telegram.chat_id, undefined);
});

test("mergeDefaults: empty legacy strings do NOT trigger migration", () => {
  // Empty strings are the historical default — they must not produce a phantom channel.
  const result = mergeDefaults({
    telegram: {
      bot_token: "",
      chat_id: "",
    },
  });
  assert.deepEqual(result.telegram.channels, []);
  assert.equal(result.telegram.bot_token, undefined);
  assert.equal(result.telegram.chat_id, undefined);
});

test("mergeDefaults: migration logs a warning so the user sees the upgrade", () => {
  const orig = console.warn;
  const logs = [];
  console.warn = (...args) => logs.push(args.join(" "));
  try {
    mergeDefaults({ telegram: { bot_token: "tok", chat_id: "id" } });
  } finally {
    console.warn = orig;
  }
  assert.ok(
    logs.some((line) => line.includes("[apx]") && line.includes("legacy telegram")),
    `expected migration warning, got: ${JSON.stringify(logs)}`,
  );
});
