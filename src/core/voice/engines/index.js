// TTS engine registry. Mirrors the LLM engine selector at src/core/engines/.
//
// Selection order:
//   1. Explicit "provider" argument passed to synthesize() / selectEngine().
//   2. voice.tts.provider in ~/.apx/config.json.
//   3. First engine whose isAvailable() returns true (preference order below).
//
// Preference (auto): piper → elevenlabs → openai → gemini → mock.
// The "mock" engine is always available and is the guaranteed fallback so
// `apx voice say "hola"` works out of the box even without any API keys.

import piper from "./piper.js";
import elevenlabs from "./elevenlabs.js";
import openai from "./openai.js";
import gemini from "./gemini.js";
import mock from "./mock.js";

const ADAPTERS = { piper, elevenlabs, openai, gemini, mock };
export const TTS_ENGINE_IDS = Object.keys(ADAPTERS);

export const AUTO_PREFERENCE = ["piper", "elevenlabs", "openai", "gemini", "mock"];

export function getTtsAdapter(provider) {
  const a = ADAPTERS[provider];
  if (!a) {
    throw new Error(
      `unknown TTS provider "${provider}". Known: ${TTS_ENGINE_IDS.join(", ")}`
    );
  }
  return a;
}

function providerConfig(globalConfig, provider) {
  return globalConfig?.voice?.tts?.[provider] || {};
}

/**
 * Resolve which engine should handle a synthesize() call.
 * Returns { provider, adapter, engineConfig }.
 */
export async function selectTtsEngine({ globalConfig, provider }) {
  const configuredProvider = provider || globalConfig?.voice?.tts?.provider || "auto";

  if (configuredProvider && configuredProvider !== "auto") {
    const adapter = getTtsAdapter(configuredProvider);
    return {
      provider: configuredProvider,
      adapter,
      engineConfig: providerConfig(globalConfig, configuredProvider),
    };
  }

  // Auto: probe preference order.
  for (const id of AUTO_PREFERENCE) {
    const adapter = ADAPTERS[id];
    const cfg = providerConfig(globalConfig, id);
    try {
      if (await adapter.isAvailable(cfg, globalConfig?.engines)) {
        return { provider: id, adapter, engineConfig: cfg };
      }
    } catch { /* probe failures fall through */ }
  }
  // Should never get here since mock is always available, but guard anyway.
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
  const out = [];
  for (const id of TTS_ENGINE_IDS) {
    const adapter = ADAPTERS[id];
    const cfg = providerConfig(globalConfig, id);
    let available = false;
    try {
      available = await adapter.isAvailable(cfg, globalConfig?.engines);
    } catch { available = false; }
    out.push({
      id,
      available,
      configured: Object.keys(cfg).length > 0,
    });
  }
  return out;
}
