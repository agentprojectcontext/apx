// Image-engine registry. Same shape as the TTS registry at core/voice/engines/
// and the LLM one at core/engines/ — one directory of uniform adapters plus an
// id→adapter map, so adding a provider touches its own file and one line here.
//
// Two selection modes (config.images.mode):
//   "chain"  — ordered fallback router. Walk config.images.order (falling back
//              to AUTO_PREFERENCE), skip engines turned off
//              (config.images.<id>.enabled === false), and take the first whose
//              isAvailable() says yes. "mock" is always kept as the final rung.
//   "single" — use exactly config.images.provider, no fallback.
//
// An explicit `provider` argument always wins (the settings tester and
// `apx image --provider` both rely on that).
//
// ── Custom providers ───────────────────────────────────────────────────────
// Any number of extra endpoints live under images.custom.<slug> and surface as
// "custom:<slug>". Unlike TTS — where every custom endpoint is OpenAI-shaped —
// an image server can speak any of the three dialects, so a custom entry
// carries a `kind` ("a1111" | "sdcpp" | "openai", default "a1111") naming which
// adapter drives it. Getting that wrong is a 404, not a subtle degradation,
// which is why it is explicit rather than sniffed.

import a1111 from "./a1111.js";
import sdcpp from "./sdcpp.js";
import openai from "./openai.js";
import mock from "./mock.js";

const ADAPTERS = { a1111, sdcpp, openai, mock };
export const IMAGE_ENGINE_IDS = Object.keys(ADAPTERS);

/**
 * Local-first, and A1111 ahead of the native sdcpp route on purpose: the same
 * stable-diffusion.cpp server answers both, but only the A1111 dialect carries
 * steps and cfg scale, and a turbo checkpoint left on a server's stock 20
 * steps / cfg 7 renders several times slower for a worse picture.
 */
export const AUTO_PREFERENCE = ["a1111", "sdcpp", "openai", "mock"];

/** Dialects a custom endpoint may declare. */
export const CUSTOM_KINDS = ["a1111", "sdcpp", "openai"];
export const CUSTOM_PREFIX = "custom:";

export function isCustomId(id) {
  return typeof id === "string" && id.startsWith(CUSTOM_PREFIX);
}
function slugOf(id) {
  return isCustomId(id) ? id.slice(CUSTOM_PREFIX.length) : id;
}
function customEngineIds(imgCfg) {
  return Object.keys(imgCfg?.custom || {}).map((slug) => CUSTOM_PREFIX + slug);
}
function knownIds(imgCfg) {
  return [...IMAGE_ENGINE_IDS, ...customEngineIds(imgCfg)];
}

export function imagesConfig(globalConfig) {
  return globalConfig?.images || {};
}

export function providerConfig(globalConfig, provider) {
  const img = imagesConfig(globalConfig);
  if (isCustomId(provider)) return img?.custom?.[slugOf(provider)] || {};
  return img?.[provider] || {};
}

/** Which adapter drives an engine id (a custom one names its dialect). */
export function getImageAdapter(provider, globalConfig) {
  if (isCustomId(provider)) {
    const kind = providerConfig(globalConfig, provider).kind || "a1111";
    const adapter = ADAPTERS[kind];
    if (!adapter) {
      throw new Error(`unknown kind "${kind}" for ${provider}. Known: ${CUSTOM_KINDS.join(", ")}`);
    }
    return adapter;
  }
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`unknown image provider "${provider}". Known: ${IMAGE_ENGINE_IDS.join(", ")}`);
  }
  return adapter;
}

function isEnabled(imgCfg, id) {
  if (isCustomId(id)) return imgCfg?.custom?.[slugOf(id)]?.enabled !== false;
  return imgCfg?.[id]?.enabled !== false;
}

/** Effective routing mode for the chain/single decision. */
export function resolveMode(imgCfg) {
  if (imgCfg?.mode === "chain" || imgCfg?.mode === "single") return imgCfg.mode;
  const p = imgCfg?.provider;
  return p && p !== "auto" ? "single" : "chain";
}

/**
 * Full engine order for chain mode: the user's order first (known ids only),
 * then whatever AUTO_PREFERENCE and the custom entries add. Disabled engines
 * stay in the list so the settings UI can render and reorder every row;
 * filtering happens at selection time.
 */
export function resolveChainOrder(imgCfg) {
  const known = knownIds(imgCfg);
  const ordered = Array.isArray(imgCfg?.order) ? imgCfg.order.filter((id) => known.includes(id)) : [];
  const rest = [...AUTO_PREFERENCE, ...customEngineIds(imgCfg)].filter((id) => !ordered.includes(id));
  const full = [...ordered, ...rest];
  if (!full.includes("mock")) full.push("mock");
  return full;
}

/**
 * Resolve which engine handles a generate() call.
 * Returns { provider, adapter, engineConfig }.
 */
export async function selectImageEngine({ globalConfig, provider }) {
  const imgCfg = imagesConfig(globalConfig);

  // 1. Explicit override (CLI --provider, the settings tester) always wins.
  if (provider && provider !== "auto") {
    return {
      provider,
      adapter: getImageAdapter(provider, globalConfig),
      engineConfig: providerConfig(globalConfig, provider),
    };
  }

  // 2. Single mode: the configured engine verbatim, no fallback.
  if (resolveMode(imgCfg) === "single") {
    const id = imgCfg?.provider;
    if (id && id !== "auto") {
      return {
        provider: id,
        adapter: getImageAdapter(id, globalConfig),
        engineConfig: providerConfig(globalConfig, id),
      };
    }
    // Misconfigured single mode (no concrete provider) falls through to chain.
  }

  // 3. Chain mode: probe the enabled order, first available wins.
  for (const id of resolveChainOrder(imgCfg)) {
    if (id !== "mock" && !isEnabled(imgCfg, id)) continue;
    let adapter;
    try { adapter = getImageAdapter(id, globalConfig); } catch { continue; }
    const cfg = providerConfig(globalConfig, id);
    try {
      if (await adapter.isAvailable(cfg, globalConfig?.engines)) {
        return { provider: id, adapter, engineConfig: cfg };
      }
    } catch { /* probe failures fall through to the next engine */ }
  }

  return { provider: "mock", adapter: mock, engineConfig: providerConfig(globalConfig, "mock") };
}

/**
 * Which engines are configured/available right now. Every entry is probed, so
 * this makes real (short-timeout) network calls — fine for a settings screen,
 * not for a hot path.
 */
export async function listAvailableImageEngines(globalConfig) {
  const imgCfg = imagesConfig(globalConfig);
  const out = [];
  for (const id of knownIds(imgCfg)) {
    const cfg = providerConfig(globalConfig, id);
    let adapter = null;
    try { adapter = getImageAdapter(id, globalConfig); } catch { /* unknown kind */ }
    let available = false;
    try {
      available = adapter ? await adapter.isAvailable(cfg, globalConfig?.engines) : false;
    } catch { available = false; }
    const custom = isCustomId(id);
    out.push({
      id,
      available,
      // `enabled`, `label` and `kind` are routing/display metadata, not config —
      // excluding them keeps "configured" from turning true the moment someone
      // toggles a row off.
      configured: Object.keys(cfg).filter((k) => !["enabled", "label", "kind"].includes(k)).length > 0,
      enabled: isEnabled(imgCfg, id),
      supports: adapter?.supports || [],
      ...(custom
        ? { custom: true, kind: cfg.kind || "a1111", label: cfg.label || slugOf(id), note: cfg.base_url || "" }
        : { note: cfg.base_url || "" }),
    });
  }
  return out;
}
