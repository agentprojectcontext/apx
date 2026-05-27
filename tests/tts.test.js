// Tests for the TTS subsystem in src/core/voice/.
//
// We exercise the public facade (synthesize / listProviders) plus the
// selector (selectTtsEngine). Real cloud engines are never hit — those
// require API keys and live HTTP. The mock engine is always available and
// is our deterministic fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { synthesize, listProviders, TTS_TMP_DIR } from "../src/core/voice/tts.js";
import {
  selectTtsEngine,
  listAvailableTtsEngines,
  TTS_ENGINE_IDS,
  AUTO_PREFERENCE,
} from "../src/core/voice/engines/index.js";
import mockEngine from "../src/core/voice/engines/mock.js";
import piperEngine from "../src/core/voice/engines/piper.js";
import elevenlabsEngine from "../src/core/voice/engines/elevenlabs.js";
import openaiEngine from "../src/core/voice/engines/openai.js";
import geminiEngine from "../src/core/voice/engines/gemini.js";

// ---------------------------------------------------------------------------
// Engine registry surface
// ---------------------------------------------------------------------------

test("registry exposes all five engines", () => {
  for (const id of ["piper", "elevenlabs", "openai", "gemini", "mock"]) {
    assert.ok(TTS_ENGINE_IDS.includes(id), `expected engine "${id}" in registry`);
  }
});

test("auto preference order falls back to mock last", () => {
  assert.equal(AUTO_PREFERENCE[AUTO_PREFERENCE.length - 1], "mock");
  assert.equal(AUTO_PREFERENCE[0], "piper");
});

// ---------------------------------------------------------------------------
// isAvailable contracts
// ---------------------------------------------------------------------------

test("mock engine is always available", async () => {
  assert.equal(await mockEngine.isAvailable(), true);
});

test("elevenlabs unavailable without api_key", async () => {
  const prev = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    assert.equal(await elevenlabsEngine.isAvailable({}), false);
    assert.equal(await elevenlabsEngine.isAvailable({ api_key: "sk_test" }), true);
  } finally {
    if (prev) process.env.ELEVENLABS_API_KEY = prev;
  }
});

test("openai-tts uses engines.openai.api_key as fallback", async () => {
  const prevEnv = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal(await openaiEngine.isAvailable({}, {}), false);
    assert.equal(
      await openaiEngine.isAvailable({}, { openai: { api_key: "sk-shared" } }),
      true
    );
    assert.equal(
      await openaiEngine.isAvailable({ api_key: "sk-explicit" }, {}),
      true
    );
  } finally {
    if (prevEnv) process.env.OPENAI_API_KEY = prevEnv;
  }
});

test("gemini-tts respects engines.gemini.api_key", async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.equal(await geminiEngine.isAvailable({}, {}), false);
    assert.equal(
      await geminiEngine.isAvailable({}, { gemini: { api_key: "k" } }),
      true
    );
  } finally {
    if (prev) process.env.GEMINI_API_KEY = prev;
  }
});

test("piper unavailable when binary not on PATH", async () => {
  // Force a binary name we know isn't installed.
  assert.equal(
    await piperEngine.isAvailable({ bin: "definitely-not-a-real-binary-xyzzy" }),
    false
  );
});

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

test("selector honours explicit provider", async () => {
  const sel = await selectTtsEngine({
    globalConfig: { voice: { tts: { provider: "auto" } } },
    provider: "mock",
  });
  assert.equal(sel.provider, "mock");
});

test("selector picks mock when nothing else configured", async () => {
  // Ensure no env keys leak into auto-detection.
  const stash = {};
  for (const k of ["ELEVENLABS_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
    stash[k] = process.env[k];
    delete process.env[k];
  }
  try {
    const sel = await selectTtsEngine({
      globalConfig: { voice: { tts: { provider: "auto" } }, engines: {} },
    });
    // Piper might happen to be installed on the test host — accept it, but
    // never accept a cloud engine we know has no key.
    assert.ok(["piper", "mock"].includes(sel.provider),
      `unexpected auto-selected provider: ${sel.provider}`);
  } finally {
    for (const [k, v] of Object.entries(stash)) if (v) process.env[k] = v;
  }
});

test("selector reads provider from config when none passed", async () => {
  const sel = await selectTtsEngine({
    globalConfig: { voice: { tts: { provider: "mock" } } },
  });
  assert.equal(sel.provider, "mock");
});

test("listAvailableTtsEngines reports configured flag", async () => {
  const list = await listAvailableTtsEngines({
    voice: { tts: { elevenlabs: { api_key: "x" } } },
  });
  const eleven = list.find((e) => e.id === "elevenlabs");
  assert.ok(eleven.configured, "elevenlabs should be marked configured");
  assert.equal(eleven.available, true);

  const mock = list.find((e) => e.id === "mock");
  assert.equal(mock.available, true);
});

// ---------------------------------------------------------------------------
// Facade — synthesize() with mock
// ---------------------------------------------------------------------------

test("synthesize produces a playable WAV via mock engine", async () => {
  const result = await synthesize({
    text: "hola manuel",
    provider: "mock",
    globalConfig: { voice: { tts: { provider: "mock" } }, engines: {} },
  });
  assert.equal(result.provider, "mock");
  assert.equal(result.mime, "audio/wav");
  assert.ok(result.audio_path && result.audio_path.endsWith(".wav"));
  assert.ok(fs.existsSync(result.audio_path), "audio file should exist on disk");
  assert.ok(result.duration_s > 0, "duration should be positive");

  // Validate RIFF/WAVE header.
  const head = fs.readFileSync(result.audio_path).subarray(0, 12);
  assert.equal(head.subarray(0, 4).toString(), "RIFF");
  assert.equal(head.subarray(8, 12).toString(), "WAVE");

  // Files should land under ~/.apx/tmp/tts/.
  assert.ok(
    result.audio_path.startsWith(TTS_TMP_DIR),
    `expected ${result.audio_path} under ${TTS_TMP_DIR}`
  );

  // Cleanup so /tmp doesn't fill up across runs.
  try { fs.unlinkSync(result.audio_path); } catch {}
});

test("synthesize rejects empty text", async () => {
  await assert.rejects(
    () => synthesize({ text: "", provider: "mock", globalConfig: {} }),
    /text required/
  );
});

test("synthesize duration scales with input length", async () => {
  const shortR = await synthesize({
    text: "hi",
    provider: "mock",
    globalConfig: { voice: { tts: { provider: "mock" } } },
  });
  const longR = await synthesize({
    text: "x".repeat(200),
    provider: "mock",
    globalConfig: { voice: { tts: { provider: "mock" } } },
  });
  assert.ok(longR.duration_s > shortR.duration_s,
    `expected long (${longR.duration_s}) > short (${shortR.duration_s})`);
  try { fs.unlinkSync(shortR.audio_path); } catch {}
  try { fs.unlinkSync(longR.audio_path); } catch {}
});

// ---------------------------------------------------------------------------
// listProviders facade
// ---------------------------------------------------------------------------

test("listProviders returns configured provider + engine list", async () => {
  const info = await listProviders({
    voice: { tts: { provider: "mock" } },
    engines: {},
  });
  assert.equal(info.configured_provider, "mock");
  assert.ok(Array.isArray(info.engines));
  assert.ok(info.engines.find((e) => e.id === "mock"));
});

// ---------------------------------------------------------------------------
// Cloud engines fail GRACEFULLY when no key is configured (no test should
// require a real key).
// ---------------------------------------------------------------------------

test("elevenlabs synthesize throws clear error without key", async () => {
  const prev = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    await assert.rejects(
      () => elevenlabsEngine.synthesize({
        text: "hola",
        outDir: path.join(os.tmpdir(), `apx-test-tts-${Date.now()}`),
        config: {},
      }),
      /no api_key/
    );
  } finally {
    if (prev) process.env.ELEVENLABS_API_KEY = prev;
  }
});

test("openai-tts synthesize throws clear error without key", async () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      () => openaiEngine.synthesize({
        text: "hola",
        outDir: path.join(os.tmpdir(), `apx-test-tts-${Date.now()}`),
        config: {},
        parentEnginesCfg: {},
      }),
      /no api_key/
    );
  } finally {
    if (prev) process.env.OPENAI_API_KEY = prev;
  }
});
