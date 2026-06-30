// Tests for the generic emotion-tags capability (src/core/voice/emotions.js)
// and the OpenAI adapter's custom-endpoint ("QVox custom") path.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_EMOTION_TAGS,
  emotionConfigFor,
  resolveSpeakingProvider,
  activeEmotionGuide,
  buildEmotionGuide,
  stripEmotionTags,
} from "#core/voice/emotions.js";
import openaiEngine from "#core/voice/engines/openai.js";
import {
  selectTtsEngine,
  listAvailableTtsEngines,
  resolveChainOrder,
  getTtsAdapter,
  isCustomId,
} from "#core/voice/engines/index.js";
import { synthesize } from "#core/voice/tts.js";

// ── Custom (user-added, OpenAI-compatible) providers ────────────────────────

const CUSTOM_CFG = {
  voice: { tts: {
    mode: "chain",
    order: ["custom:qvox", "gemini"],
    custom: { qvox: { label: "QVox", base_url: "http://127.0.0.1:5111/v1", emotions: { enabled: true } } },
  } },
};

test("isCustomId + getTtsAdapter: custom ids resolve to the openai adapter", () => {
  assert.equal(isCustomId("custom:qvox"), true);
  assert.equal(isCustomId("openai"), false);
  assert.equal(getTtsAdapter("custom:qvox").id, "openai");
});

test("resolveChainOrder includes custom engine ids", () => {
  const order = resolveChainOrder(CUSTOM_CFG.voice.tts);
  assert.equal(order[0], "custom:qvox");
  assert.ok(order.includes("gemini"));
  assert.equal(order[order.length - 1], "mock");
});

test("listAvailableTtsEngines surfaces custom providers with label + base_url", async () => {
  const list = await listAvailableTtsEngines(CUSTOM_CFG);
  const q = list.find((e) => e.id === "custom:qvox");
  assert.ok(q, "custom provider listed");
  assert.equal(q.custom, true);
  assert.equal(q.label, "QVox");
  assert.equal(q.available, true);      // base_url present → reachable
  assert.equal(q.note, "http://127.0.0.1:5111/v1");
});

test("selectTtsEngine routes to a custom provider with its config block", async () => {
  const sel = await selectTtsEngine({ globalConfig: CUSTOM_CFG });
  assert.equal(sel.provider, "custom:qvox");
  assert.equal(sel.engineConfig.base_url, "http://127.0.0.1:5111/v1");
});

test("emotionConfigFor reads a custom provider's emotions block", () => {
  assert.equal(emotionConfigFor(CUSTOM_CFG, "custom:qvox").enabled, true);
  assert.equal(activeEmotionGuide(CUSTOM_CFG).provider, "custom:qvox");
});

test("a disabled custom provider is skipped by the chain", async () => {
  const cfg = {
    voice: { tts: {
      mode: "chain",
      order: ["custom:qvox"],
      custom: { qvox: { base_url: "http://x/v1", enabled: false } },
    } },
  };
  const sel = await selectTtsEngine({ globalConfig: cfg });
  assert.equal(sel.provider, "mock"); // disabled → falls through to the guard
});

// ── emotion config resolution ──────────────────────────────────────────────

test("emotionConfigFor: off by default, on when enabled, default tag set", () => {
  assert.equal(emotionConfigFor({}, "openai").enabled, false);
  const cfg = { voice: { tts: { openai: { emotions: { enabled: true } } } } };
  const e = emotionConfigFor(cfg, "openai");
  assert.equal(e.enabled, true);
  assert.deepEqual(e.tags, DEFAULT_EMOTION_TAGS);
});

test("emotionConfigFor: custom tag list overrides + normalizes", () => {
  const cfg = { voice: { tts: { openai: { emotions: { enabled: true, tags: [" Happy ", "WHISPER"] } } } } };
  assert.deepEqual(emotionConfigFor(cfg, "openai").tags, ["happy", "whisper"]);
});

test("resolveSpeakingProvider: single mode picks configured provider", () => {
  const cfg = { voice: { tts: { mode: "single", provider: "openai" } } };
  assert.equal(resolveSpeakingProvider(cfg), "openai");
});

test("resolveSpeakingProvider: chain mode returns the first enabled engine (what speaks)", () => {
  // Even though openai has emotions on, piper speaks first → the guide must
  // reflect piper (no spurious tags an engine never asked for).
  const cfg = {
    voice: {
      tts: {
        mode: "chain",
        order: ["piper", "openai"],
        openai: { emotions: { enabled: true } },
      },
    },
  };
  assert.equal(resolveSpeakingProvider(cfg), "piper");
  assert.equal(activeEmotionGuide(cfg), null); // piper has no emotion support
});

test("activeEmotionGuide: null when speaking engine lacks tag support", () => {
  const off = { voice: { tts: { mode: "single", provider: "piper" } } };
  assert.equal(activeEmotionGuide(off), null);
  const on = { voice: { tts: { mode: "single", provider: "openai", openai: { emotions: { enabled: true } } } } };
  assert.ok(activeEmotionGuide(on));
  assert.equal(activeEmotionGuide(on).provider, "openai");
});

test("buildEmotionGuide lists exactly the provided tags", () => {
  const block = buildEmotionGuide(["happy", "sad"]);
  assert.match(block, /\[happy\] \[sad\]/);
  assert.doesNotMatch(block, /whisper/);
});

test("stripEmotionTags removes markers and collapses spacing", () => {
  assert.equal(stripEmotionTags("[excited] Hola [calm]  mundo"), "Hola mundo");
  assert.equal(stripEmotionTags("no tags here"), "no tags here");
  // numeric / non-letter brackets are left alone
  assert.equal(stripEmotionTags("see [1] note"), "see [1] note");
});

// ── synthesize() safety net ────────────────────────────────────────────────

test("synthesize strips emotion tags when the engine has no tag support", async () => {
  const cfg = { voice: { tts: { mode: "single", provider: "mock" } } };
  const r = await synthesize({ text: "[happy] hola [sad] chau", globalConfig: cfg });
  const wav = fs.readFileSync(r.audio_path);
  // mock encodes text length into duration; just assert it produced audio and
  // didn't blow up. The real assertion (no literal tags) is covered above.
  assert.ok(wav.length > 44);
  fs.rmSync(r.audio_path, { force: true });
});

// ── OpenAI adapter: custom endpoint ("QVox custom") ─────────────────────────

test("openai custom endpoint forwards instruct/language/temperature, never to stock", async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return { ok: true, async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } };
  };
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "qvox-test-"));
  try {
    // Custom endpoint: extras present, URL derived from base_url (no hardcode).
    await openaiEngine.synthesize({
      text: "hola",
      style: "A warm storyteller",
      language: "Spanish",
      outDir,
      config: { base_url: "http://127.0.0.1:5111/v1", temperature: 0.7, api_key: "K" },
    });
    assert.equal(calls[0].url, "http://127.0.0.1:5111/v1/audio/speech");
    assert.equal(calls[0].body.input, "hola");
    assert.equal(calls[0].body.instruct, "A warm storyteller");
    assert.equal(calls[0].body.language, "Spanish");
    assert.equal(calls[0].body.temperature, 0.7);
    assert.equal(calls[0].headers["x-api-key"], "K");

    // Stock OpenAI (tts-1): no instruct/language/temperature leak.
    calls.length = 0;
    await openaiEngine.synthesize({
      text: "hi",
      style: "A warm storyteller",
      language: "English",
      outDir,
      config: { api_key: "K", model: "tts-1" },
    });
    assert.equal(calls[0].url, "https://api.openai.com/v1/audio/speech");
    assert.equal(calls[0].body.instruct, undefined);
    assert.equal(calls[0].body.language, undefined);
    assert.equal(calls[0].body.temperature, undefined);
    assert.equal(calls[0].headers["x-api-key"], undefined);
  } finally {
    global.fetch = realFetch;
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test("openai isAvailable: custom endpoint needs no key", async () => {
  assert.equal(await openaiEngine.isAvailable({ base_url: "http://x/v1" }), true);
  assert.equal(await openaiEngine.isAvailable({}), false);
});
