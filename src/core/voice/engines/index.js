// TTS engine registry. Mirrors the LLM engine selector at src/core/engines/.
//
// Two selection modes (config.voice.tts.mode):
//   "chain"  — ordered fallback router. Walk the engine order (config.voice.tts
//              .order, falling back to AUTO_PREFERENCE) skipping engines turned
//              off (config.voice.tts.<id>.enabled === false) and pick the first
//              one whose isAvailable() returns true. "mock" is always kept as
//              the final guaranteed fallback.
//   "single" — use exactly config.voice.tts.provider, no fallback. Lets you keep
//              several engines configured but only ever use the chosen one by
//              default (the others stay available for explicit overrides).
//
// An explicit `provider` argument to synthesize()/selectTtsEngine() always wins
// (used by the "Probar voz" tester to force a specific engine).
//
// Backward compat: when `mode` is absent it's derived from `provider`
// (provider set & not "auto" → single; otherwise chain), so existing configs
// keep working unchanged.

import piper from "./piper.js";
import elevenlabs from "./elevenlabs.js";
import openai from "./openai.js";
import gemini from "./gemini.js";
import mock from "./mock.js";

const ADAPTERS = { piper, elevenlabs, openai, gemini, mock };
export const TTS_ENGINE_IDS = Object.keys(ADAPTERS);

export const AUTO_PREFERENCE = ["piper", "elevenlabs", "openai", "gemini", "mock"];

// ── Custom providers ────────────────────────────────────────────────────────
// Users can add any number of OpenAI-compatible endpoints (e.g. a local QVox /
// Qwen3-TTS server). They live under voice.tts.custom.<slug> and surface with
// engine id "custom:<slug>". They're all backed by the openai adapter.
export const CUSTOM_PREFIX = "custom:";

export function isCustomId(id) {
  return typeof id === "string" && id.startsWith(CUSTOM_PREFIX);
}
function slugOf(id) {
  return isCustomId(id) ? id.slice(CUSTOM_PREFIX.length) : id;
}
function customEngineIds(ttsCfg) {
  return Object.keys(ttsCfg?.custom || {}).map((slug) => CUSTOM_PREFIX + slug);
}
function knownIds(ttsCfg) {
  return [...TTS_ENGINE_IDS, ...customEngineIds(ttsCfg)];
}

export function getTtsAdapter(provider) {
  // All custom providers are OpenAI-compatible → openai adapter.
  if (isCustomId(provider)) return ADAPTERS.openai;
  const a = ADAPTERS[provider];
  if (!a) {
    throw new Error(
      `unknown TTS provider "${provider}". Known: ${TTS_ENGINE_IDS.join(", ")}`
    );
  }
  return a;
}

function ttsConfig(globalConfig) {
  return globalConfig?.voice?.tts || {};
}

function providerConfig(globalConfig, provider) {
  const tts = ttsConfig(globalConfig);
  if (isCustomId(provider)) return tts?.custom?.[slugOf(provider)] || {};
  return tts?.[provider] || {};
}

function isEnabled(ttsCfg, id) {
  if (isCustomId(id)) return ttsCfg?.custom?.[slugOf(id)]?.enabled !== false;
  return ttsCfg?.[id]?.enabled !== false;
}

/** Effective routing mode for the chain/single decision. */
export function resolveMode(ttsCfg) {
  if (ttsCfg?.mode === "chain" || ttsCfg?.mode === "single") return ttsCfg.mode;
  const p = ttsCfg?.provider;
  return p && p !== "auto" ? "single" : "chain";
}

/**
 * Full engine order for chain mode: the user's custom order first (only known
 * ids), then any remaining AUTO_PREFERENCE engines. Includes disabled engines
 * so the UI can render + reorder every row; filtering happens at selection time.
 */
export function resolveChainOrder(ttsCfg) {
  const known = knownIds(ttsCfg);
  const ordered = Array.isArray(ttsCfg?.order)
    ? ttsCfg.order.filter((id) => known.includes(id))
    : [];
  const rest = [...AUTO_PREFERENCE, ...customEngineIds(ttsCfg)].filter(
    (id) => !ordered.includes(id)
  );
  const full = [...ordered, ...rest];
  // Guarantee mock is present as the ultimate fallback.
  if (!full.includes("mock")) full.push("mock");
  return full;
}

/**
 * Resolve which engine should handle a synthesize() call.
 * Returns { provider, adapter, engineConfig }.
 */
export async function selectTtsEngine({ globalConfig, provider }) {
  const ttsCfg = ttsConfig(globalConfig);

  // 1. Explicit override (tester / API caller) always wins.
  if (provider && provider !== "auto") {
    const adapter = getTtsAdapter(provider);
    return { provider, adapter, engineConfig: providerConfig(globalConfig, provider) };
  }

  const mode = resolveMode(ttsCfg);

  // 2. Single mode: use the configured engine verbatim, no fallback.
  if (mode === "single") {
    const id = ttsCfg?.provider;
    if (id && id !== "auto") {
      const adapter = getTtsAdapter(id);
      return { provider: id, adapter, engineConfig: providerConfig(globalConfig, id) };
    }
    // Misconfigured single mode (no concrete provider) → fall through to chain.
  }

  // 3. Chain mode: probe the (enabled) order, first available wins.
  for (const id of resolveChainOrder(ttsCfg)) {
    if (id !== "mock" && !isEnabled(ttsCfg, id)) continue;
    const adapter = getTtsAdapter(id);
    const cfg = providerConfig(globalConfig, id);
    try {
      if (await adapter.isAvailable(cfg, globalConfig?.engines)) {
        return { provider: id, adapter, engineConfig: cfg };
      }
    } catch { /* probe failures fall through */ }
  }
  // mock is always available, but guard anyway.
  return {
    provider: "mock",
    adapter: mock,
    engineConfig: providerConfig(globalConfig, "mock"),
  };
}

/**
 * Discover which engines are configured/available right now. Pure read of
 * config + cheap probes; safe to call frequently.
 */
export async function listAvailableTtsEngines(globalConfig) {
  const ttsCfg = ttsConfig(globalConfig);
  const out = [];
  for (const id of knownIds(ttsCfg)) {
    const adapter = getTtsAdapter(id);
    const cfg = providerConfig(globalConfig, id);
    let available = false;
    try {
      available = await adapter.isAvailable(cfg, globalConfig?.engines);
    } catch { available = false; }
    const custom = isCustomId(id);
    out.push({
      id,
      available,
      // `enabled` is a routing flag, not real config — exclude it from the
      // "configured" heuristic so toggling on/off doesn't fake-mark an engine.
      // For custom engines `label` is descriptive metadata, not config either.
      configured: Object.keys(cfg).filter((k) => k !== "enabled" && k !== "label").length > 0,
      enabled: isEnabled(ttsCfg, id),
      ...(custom ? { custom: true, label: cfg.label || slugOf(id), note: cfg.base_url || "" } : {}),
    });
  }
  return out;
}
