// Generic "emotion tags" capability for TTS engines.
//
// Some speech backends (e.g. a local Qwen3-TTS / QVox server, reached through
// the OpenAI-compatible `openai` adapter pointed at a custom base_url) accept
// inline [tag] markers in the text and switch the speaking emotion per segment
// while keeping the same base voice. QVox's tag set is the canonical default
// (see qwen3-tts-api `_app.py` TAG_INSTRUCTS).
//
// This capability is NOT hard-coded into any adapter. It's a per-engine config
// toggle (`voice.tts.<id>.emotions.enabled`) so it can be ADDED to whichever
// engine the user actually points at an emotion-aware backend — the custom
// OpenAI endpoint today, anything tomorrow. Two responsibilities live here:
//   1. activeEmotionGuide() — what the prompt builder injects (voice mode only)
//      so the agent learns the tag syntax, but ONLY when the engine that will
//      speak supports tags.
//   2. stripEmotionTags() — a safety net so that if a turn ends up on an engine
//      WITHOUT tag support, stray markers are scrubbed and never read aloud.

import { resolveMode, resolveChainOrder, isCustomId, CUSTOM_PREFIX } from "./engines/index.js";

// Canonical tag set (mirrors QVox TAG_INSTRUCTS keys, de-duplicated).
export const DEFAULT_EMOTION_TAGS = [
  "happy", "sad", "excited", "angry", "calm",
  "whisper", "shout", "laugh", "cry", "narrator", "neutral",
];

const TAG_RE = /\[[a-zA-Z]{2,12}\]/g;

function ttsCfg(globalConfig) {
  return globalConfig?.voice?.tts || {};
}

// Per-engine config block (built-in id → voice.tts.<id>; custom:<slug> →
// voice.tts.custom.<slug>).
function providerBlock(globalConfig, providerId) {
  const tts = ttsCfg(globalConfig);
  if (isCustomId(providerId)) return tts?.custom?.[providerId.slice(CUSTOM_PREFIX.length)] || {};
  return tts?.[providerId] || {};
}

function enabledOf(tts, id) {
  if (isCustomId(id)) return tts?.custom?.[id.slice(CUSTOM_PREFIX.length)]?.enabled !== false;
  return tts?.[id]?.enabled !== false;
}

/**
 * Emotion capability declared for one engine id. `enabled` is false when the
 * block is missing or turned off; `tags` falls back to the canonical set.
 */
export function emotionConfigFor(globalConfig, providerId) {
  const e = providerBlock(globalConfig, providerId)?.emotions;
  const enabled = !!e?.enabled;
  const tags = Array.isArray(e?.tags) && e.tags.length
    ? e.tags.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    : DEFAULT_EMOTION_TAGS;
  return { enabled, tags };
}

/**
 * Best-effort, SYNCHRONOUS resolution of which engine will speak. Used at
 * prompt-build time (which is sync and must not probe isAvailable()). Mirrors
 * the intent of selectTtsEngine without the async availability probes:
 *   - explicit provider arg wins
 *   - single mode → voice.tts.provider
 *   - chain mode → the FIRST enabled engine in order (what selectTtsEngine
 *     would speak with). We deliberately do NOT prefer an emotion-capable
 *     engine here: the guide must reflect the engine that will actually speak,
 *     otherwise the agent emits tags a different engine never asked for.
 */
export function resolveSpeakingProvider(globalConfig, provider) {
  if (provider && provider !== "auto") return provider;
  const cfg = ttsCfg(globalConfig);
  const mode = resolveMode(cfg);
  if (mode === "single" && cfg.provider && cfg.provider !== "auto") return cfg.provider;
  const order = resolveChainOrder(cfg).filter(
    (id) => id !== "mock" && enabledOf(cfg, id)
  );
  return order[0] || cfg.provider || undefined;
}

/**
 * The emotion guide to inject for a voice-mode turn, or null when the engine
 * that will speak does not support tags. `provider` optionally forces a
 * specific engine (e.g. a tester override).
 */
export function activeEmotionGuide(globalConfig, provider) {
  const id = resolveSpeakingProvider(globalConfig, provider);
  if (!id) return null;
  const { enabled, tags } = emotionConfigFor(globalConfig, id);
  return enabled ? { provider: id, tags } : null;
}

/** Markdown block teaching the inline-tag syntax. Appended to modes/voice.md. */
export function buildEmotionGuide(tags = DEFAULT_EMOTION_TAGS) {
  const list = (Array.isArray(tags) && tags.length ? tags : DEFAULT_EMOTION_TAGS).join("] [");
  return [
    "## Emotion tags (spoken delivery)",
    "The voice engine for this turn understands inline emotion tags. You MAY drop them into your spoken reply to color the delivery — a tag affects the words that follow it, until the next tag.",
    `Available tags: [${list}]`,
    'Write the tag in square brackets right before the phrase it colors (e.g. "[excited] ¡Listo! [calm] Lo dejé anotado."). Use them sparingly — at most one or two per reply, only when the emotion genuinely helps. The tags are removed before synthesis (never spoken). Never invent tags outside the list above.',
  ].join("\n");
}

/** Remove stray [tag] markers so a non-tag engine never reads them aloud. */
export function stripEmotionTags(text) {
  if (typeof text !== "string") return text;
  return text.replace(TAG_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}
