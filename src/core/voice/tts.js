// Unified TTS facade. Callers don't pick the engine — the selector does.
//
//   synthesize({ text, voice?, language?, format?, provider? })
//     → { audio_path, duration_s, mime, provider }
//
// All audio files land under ~/.apx/tmp/tts/<uuid>.<ext>. Callers are
// responsible for cleaning up (Telegram plugin already uses similar temp
// files via /api/telegram/send_voice).

import fs from "node:fs";
import { TTS_TMP_DIR } from "#core/config/paths.js";

export { TTS_TMP_DIR };
import { readConfig } from "../config/index.js";
import {
  resolveTtsCandidates,
  listAvailableTtsEngines,
  resolveMode,
  resolveChainOrder,
} from "./engines/index.js";
import { emotionConfigFor, stripEmotionTags } from "./emotions.js";
import { logWarn } from "#core/logging.js";



export function ensureTtsTmpDir() {
  fs.mkdirSync(TTS_TMP_DIR, { recursive: true });
  return TTS_TMP_DIR;
}

/**
 * Generate speech audio for `text`. In chain mode every configured engine is
 * tried in order until one answers, so a dead local server costs a retry and
 * not the voice. The returned `provider` says who actually spoke: "mock" means
 * nothing did and the audio is silence — check it before presenting the result
 * as speech.
 *
 * @param {object} opts
 * @param {string} opts.text       Text to speak. Required.
 * @param {string} [opts.voice]    Engine-specific voice id/path/name.
 * @param {string} [opts.language] ISO 639-1 hint (rarely used; engines mostly
 *                                  auto-detect via multilingual models).
 * @param {string} [opts.format]   "mp3" | "wav" | "ogg" — engine may override.
 * @param {string} [opts.provider] Force a specific engine (skips selector).
 * @param {string} [opts.style]    Natural-language speaking-style instruction
 *                                  (engines that support it, e.g. Gemini, use
 *                                  it; others ignore it).
 * @param {object} [opts.globalConfig]  Pass-in for tests; falls back to readConfig().
 * @returns {Promise<{audio_path, duration_s, mime, provider}>}
 */
/**
 * Duration of a PCM WAV, read from its header. Most engines don't report one —
 * mock and piper were the only two that did, which is how the desktop ended up
 * able to play its silent placeholder and nothing else — and a player that
 * doesn't know how long the clip is can't draw a progress bar.
 *
 * The chunks are walked rather than read at fixed offsets. Only the canonical
 * 44-byte layout puts `fmt ` at 12 and `data` at 36; a float32 wav carries a
 * `fact` chunk between them, and reading offset 40 there lands mid-chunk and
 * yields a confident wrong answer — a 12.4s clip reported as 3.0s.
 *
 * Returns null for anything that isn't a readable RIFF/WAVE (mp3, ogg).
 */
function wavDurationSeconds(filePath) {
  try {
    const head = Buffer.alloc(4096);
    const fd = fs.openSync(filePath, "r");
    const read = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    if (read < 12) return null;
    if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") return null;

    let byteRate = 0;
    let pos = 12;
    while (pos + 8 <= read) {
      const id = head.toString("ascii", pos, pos + 4);
      const size = head.readUInt32LE(pos + 4);
      const body = pos + 8;
      if (id === "fmt " && body + 16 <= read) byteRate = head.readUInt32LE(body + 8);
      // `data` is the last chunk read: its size is the sample bytes, and by
      // now `fmt ` has been seen, since a wav that ordered them the other way
      // would be unplayable everywhere else too.
      if (id === "data") return byteRate ? size / byteRate : null;
      pos = body + size + (size % 2); // chunks are word-aligned
    }
    return null;
  } catch {
    return null;
  }
}

export async function synthesize({
  text,
  voice,
  language,
  format,
  provider,
  style,
  globalConfig,
  signal,
} = {}) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("synthesize: text required");
  }
  const cfg = globalConfig || readConfig() || {};
  const candidates = await resolveTtsCandidates({ globalConfig: cfg, provider });
  const outDir = ensureTtsTmpDir();

  // Walk the chain. An engine that throws (local server down, key revoked,
  // quota) hands the text to the next one — being available and answering are
  // different questions, and only the request settles the second.
  let lastError = null;
  for (const { provider: selectedProvider, adapter, engineConfig } of candidates) {
    // Safety net: if the engine that will speak does NOT support inline emotion
    // tags, scrub any stray [tag] markers so they're never read aloud literally.
    const speakText = emotionConfigFor(cfg, selectedProvider).enabled
      ? text
      : stripEmotionTags(text);
    try {
      const r = await adapter.synthesize({
        text: speakText,
        voice,
        language,
        format,
        style,
        outDir,
        config: engineConfig,
        parentEnginesCfg: cfg.engines,
        signal,
      });
      return {
        ...r,
        // Fill in what the engine didn't measure, so every caller sees the same
        // shape whoever spoke.
        duration_s: r.duration_s ?? (r.audio_path ? wavDurationSeconds(r.audio_path) : null),
        provider: selectedProvider || r.provider,
      };
    } catch (e) {
      lastError = e;
      // An aborted turn is the caller changing its mind, not an engine fault —
      // trying the next voice would speak a reply nobody is waiting for.
      if (e?.name === "AbortError" || signal?.aborted) throw e;
      logWarn("tts", `${selectedProvider} failed — ${e?.message || e}`);
    }
  }
  throw lastError || new Error("synthesize: no TTS engine available");
}

/**
 * Speak, handing back the audio while it is still being made.
 *
 * `synthesize()` cannot answer until the last sample exists, because it returns
 * a path to a finished file. That is the right shape for a Telegram voice note,
 * which cannot be sent until it is complete anyway — but it is the wrong shape
 * for anyone listening live, who spends the whole generation in silence. The
 * same line reaches its first chunk here in about a tenth of the time.
 *
 * onChunk(pcmBuffer, sampleRate) is called per chunk: 16-bit little-endian
 * mono, no header, no file on disk. Resolves with the totals.
 *
 * Only self-hosted engines can do this, so unlike synthesize() there is no
 * chain to walk: an engine either streams or it does not, and quietly falling
 * back to a different voice mid-sentence would be worse than saying so. Callers
 * that just want audio should catch and use synthesize().
 */
export async function synthesizeStream({
  text,
  voice,
  language,
  provider,
  style,
  interval,
  globalConfig,
  signal,
} = {}, onChunk) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("synthesizeStream: text required");
  }
  if (typeof onChunk !== "function") {
    throw new Error("synthesizeStream: onChunk required");
  }
  const cfg = globalConfig || readConfig() || {};
  const candidates = await resolveTtsCandidates({ globalConfig: cfg, provider });
  const first = candidates.find((c) => typeof c.adapter?.synthesizeStream === "function" &&
    c.adapter.canStream?.(c.engineConfig));
  if (!first) {
    const names = candidates.map((c) => c.provider).join(", ") || "none";
    throw new Error(`synthesizeStream: no streaming engine available (tried: ${names})`);
  }

  const speakText = emotionConfigFor(cfg, first.provider).enabled
    ? text
    : stripEmotionTags(text);

  const r = await first.adapter.synthesizeStream({
    text: speakText,
    voice,
    language,
    style,
    interval,
    config: first.engineConfig,
    parentEnginesCfg: cfg.engines,
    signal,
  }, onChunk);
  return { ...r, provider: first.provider };
}

/** Whether the engine that would speak next can stream. */
export async function canStreamTts({ globalConfig, provider } = {}) {
  const cfg = globalConfig || readConfig() || {};
  try {
    const candidates = await resolveTtsCandidates({ globalConfig: cfg, provider });
    return candidates.some((c) => typeof c.adapter?.synthesizeStream === "function" &&
      c.adapter.canStream?.(c.engineConfig));
  } catch {
    return false;
  }
}

/**
 * Ask whoever is about to speak to get ready, if they can.
 *
 * Only the engine that would actually handle the next synthesize() is warmed —
 * warming the whole chain would spin up fallbacks that are not going to be
 * used. Engines with nothing to warm (every cloud API) simply have no warmup()
 * and are skipped.
 *
 * Fire-and-forget by contract: a warmup that fails costs a slower first reply,
 * never a failed one, so this resolves rather than throws.
 */
export async function warmupTts({ globalConfig } = {}) {
  const cfg = globalConfig || readConfig() || {};
  const [first] = await resolveTtsCandidates({ globalConfig: cfg });
  if (!first) return { ok: false, error: "no TTS engine" };
  if (typeof first.adapter.warmup !== "function") {
    return { ok: true, provider: first.provider, skipped: "engine has no warmup" };
  }
  try {
    const r = await first.adapter.warmup(first.engineConfig, cfg.engines);
    return { ok: true, provider: first.provider, ...r };
  } catch (e) {
    logWarn("tts", `warmup of ${first.provider} failed — ${e?.message || e}`);
    return { ok: false, provider: first.provider, error: e?.message || String(e) };
  }
}

/** List engines and whether they look usable right now. */
export async function listProviders(globalConfig) {
  const cfg = globalConfig || readConfig() || {};
  const ttsCfg = cfg?.voice?.tts || {};
  const engines = await listAvailableTtsEngines(cfg);
  return {
    configured_provider: ttsCfg.provider || "auto",
    mode: resolveMode(ttsCfg),
    order: resolveChainOrder(ttsCfg),
    engines,
  };
}
