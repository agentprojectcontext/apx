// Unified TTS facade. Callers don't pick the engine — the selector does.
//
//   synthesize({ text, voice?, language?, format?, provider? })
//     → { audio_path, duration_s, mime, provider }
//
// All audio files land under ~/.apx/tmp/tts/<uuid>.<ext>. Callers are
// responsible for cleaning up (Telegram plugin already uses similar temp
// files via /telegram/send_voice).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readConfig } from "../config.js";
import { selectTtsEngine, listAvailableTtsEngines } from "./engines/index.js";

export const TTS_TMP_DIR = path.join(os.homedir(), ".apx", "tmp", "tts");

export function ensureTtsTmpDir() {
  fs.mkdirSync(TTS_TMP_DIR, { recursive: true });
  return TTS_TMP_DIR;
}

/**
 * Generate speech audio for `text`. Throws on real errors. Falls back to mock
 * silently only when provider="auto" AND nothing real is configured.
 *
 * @param {object} opts
 * @param {string} opts.text       Text to speak. Required.
 * @param {string} [opts.voice]    Engine-specific voice id/path/name.
 * @param {string} [opts.language] ISO 639-1 hint (rarely used; engines mostly
 *                                  auto-detect via multilingual models).
 * @param {string} [opts.format]   "mp3" | "wav" | "ogg" — engine may override.
 * @param {string} [opts.provider] Force a specific engine (skips selector).
 * @param {object} [opts.globalConfig]  Pass-in for tests; falls back to readConfig().
 * @returns {Promise<{audio_path, duration_s, mime, provider}>}
 */
export async function synthesize({
  text,
  voice,
  language,
  format,
  provider,
  globalConfig,
  signal,
} = {}) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("synthesize: text required");
  }
  const cfg = globalConfig || readConfig() || {};
  const { provider: selectedProvider, adapter, engineConfig } = await selectTtsEngine({
    globalConfig: cfg,
    provider,
  });

  const outDir = ensureTtsTmpDir();
  return adapter.synthesize({
    text,
    voice,
    language,
    format,
    outDir,
    config: engineConfig,
    parentEnginesCfg: cfg.engines,
    signal,
  }).then((r) => ({ ...r, provider: r.provider || selectedProvider }));
}

/** List engines and whether they look usable right now. */
export async function listProviders(globalConfig) {
  const cfg = globalConfig || readConfig() || {};
  const engines = await listAvailableTtsEngines(cfg);
  const configured = cfg?.voice?.tts?.provider || "auto";
  return {
    configured_provider: configured,
    engines,
  };
}
