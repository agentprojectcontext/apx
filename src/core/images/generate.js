// Unified image-generation facade. Callers don't pick the engine — the
// selector does, exactly like core/voice/tts.js does for speech.
//
//   generate({ prompt, ... })  → { images: [{path, …}], provider, model, … }
//   listProviders()            → catalog + availability for the settings UI
//   capabilities({ provider }) → live model/sampler list from one server
//
// Files land under ~/.apx/images/<YYYY-MM-DD>/ and STAY there: a generated
// picture is an artifact the user asked for, not a scratch file, and nothing
// is ever written into a project checkout unless a caller passes an explicit
// destination.

import fs from "node:fs";
import path from "node:path";
import { IMAGES_DIR } from "#core/config/paths.js";
import { readConfig } from "#core/config/index.js";
import {
  selectImageEngine,
  listAvailableImageEngines,
  getImageAdapter,
  providerConfig,
  imagesConfig,
  resolveMode,
  resolveChainOrder,
} from "./engines/index.js";
import { parseSize, redactImagePayload } from "./engines/shared.js";

export { IMAGES_DIR };

/**
 * Family-wide fallbacks. Deliberately conservative — 512² at 20 steps renders
 * on any machine — and every one of them is overridable per call, then per
 * engine (images.<id>.defaults), then globally (images.defaults).
 */
export const FAMILY_DEFAULTS = Object.freeze({
  width: 512,
  height: 512,
  steps: 20,
  cfg_scale: 7,
  seed: -1,
  count: 1,
  format: "png",
  negative_prompt: "",
  sampler: "",
  scheduler: "",
});

/** Every knob an adapter may be asked to honor. Order is display order. */
export const REQUEST_OPTIONS = Object.freeze([
  "negative_prompt", "width", "height", "steps", "cfg_scale",
  "seed", "sampler", "scheduler", "count", "format", "model",
  "init_image", "denoising_strength", "control_image", "control_strength",
  "mask", "mask_blur", "inpainting_fill", "inpaint_full_res",
]);

/**
 * The two ways a caller can hand in a reference picture. They are different
 * operations against different routes, not two spellings of one:
 *
 *   init_image     the canvas the sampler starts from   (img2img, a1111 route)
 *   control_image  a structural hint it renders around  (ControlNet, sdcpp route)
 *
 * `mask` is not a third one: it is a modifier on init_image that confines the
 * repaint to part of the canvas (inpainting), which is why it rides the same
 * route and is refused on its own.
 *
 * No engine speaks both, which is exactly why they are separate keys — folding
 * them into one "reference image" would make the engine silently pick a
 * meaning, and the two produce very different pictures.
 */
export const IMAGE_INPUTS = Object.freeze(["init_image", "control_image", "mask"]);

/** Swap base64 payloads for a size marker in anything echoed back to a caller. */
function redactInputs(request) {
  const out = { ...request };
  for (const k of IMAGE_INPUTS) {
    if (out[k]) out[k] = redactImagePayload(out[k]);
  }
  return out;
}

/** Today's folder under the gallery. Dated so a busy week stays navigable. */
export function imageOutDir(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const dir = path.join(IMAGES_DIR, day);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Drop undefined/empty entries so a later layer's value isn't masked by "". */
function present(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Fold the four layers of settings into one request. Later wins:
 *   family defaults → images.defaults → images.<engine>.defaults → the call.
 * A `size: "768x512"` at any layer expands into width/height, because that is
 * how humans and OpenAI-shaped APIs say it.
 */
export function resolveRequest({ imgCfg = {}, engineCfg = {}, request = {} } = {}) {
  const expand = (layer) => {
    const copy = present(layer);
    if (copy.size) {
      const parsed = parseSize(copy.size);
      delete copy.size;
      if (parsed) Object.assign(copy, parsed);
    }
    return copy;
  };
  return {
    ...FAMILY_DEFAULTS,
    ...expand(imgCfg.defaults),
    ...expand(engineCfg.defaults),
    ...expand(request),
  };
}

/**
 * Which of the caller's *explicit* knobs this engine cannot honor.
 *
 * Project rule: an adapter must honor — or explicitly declare it lacks — every
 * option the family passes. Declaring is what `supports` does; this is the
 * other half, so `--steps 8` against an OpenAI endpoint says so out loud
 * instead of rendering something silently different from what was asked.
 */
export function ignoredOptions(adapter, request = {}) {
  const supported = new Set(adapter?.supports || []);
  return REQUEST_OPTIONS.filter((k) => {
    if (supported.has(k)) return false;
    const v = request[k];
    if (v === undefined || v === null || v === "") return false;
    // A default-valued knob was not "asked for" — only report a real choice.
    if (k === "seed" && Number(v) === -1) return false;
    if (k === "count" && Number(v) === 1) return false;
    return true;
  });
}

/**
 * Generate one or more images. Throws on real errors; only falls back to the
 * mock engine when nothing at all is configured AND no provider was forced
 * (same contract as synthesize()).
 *
 * @param {object}   opts
 * @param {string}   opts.prompt            What to draw. Required.
 * @param {string}  [opts.negative_prompt]  What to avoid.
 * @param {number}  [opts.width]            Pixels; also settable as `size`.
 * @param {number}  [opts.height]
 * @param {string}  [opts.size]             "768x512" — expands to width/height.
 * @param {number}  [opts.steps]            Sampling steps.
 * @param {number}  [opts.cfg_scale]        Prompt adherence.
 * @param {number}  [opts.seed]             -1 for random.
 * @param {string}  [opts.sampler]          Engine-specific sampler id.
 * @param {string}  [opts.scheduler]        Engine-specific scheduler id.
 * @param {number}  [opts.count]            How many images.
 * @param {string}  [opts.format]           png | jpeg | webp.
 * @param {string}  [opts.model]            Checkpoint / model id.
 * @param {string}  [opts.provider]         Force an engine (skips the chain).
 * @param {string}  [opts.outDir]           Where to write; defaults to the gallery.
 * @param {object}  [opts.globalConfig]     Pass-in for tests; else readConfig().
 * @param {Function}[opts.onProgress]       ({status, queue_position}) while polling.
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{images, provider, model, prompt, request, ignored, elapsed_ms, meta}>}
 */
export async function generate({
  prompt,
  provider,
  outDir,
  globalConfig,
  onProgress,
  signal,
  ...rest
} = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("generate: prompt required");
  }
  const cfg = globalConfig || readConfig() || {};
  const { provider: selected, adapter, engineConfig } = await selectImageEngine({
    globalConfig: cfg,
    provider,
  });

  const request = resolveRequest({
    imgCfg: imagesConfig(cfg),
    engineCfg: engineConfig,
    request: rest,
  });
  const declaredIgnored = ignoredOptions(adapter, { ...present(rest) });

  const dir = outDir || imageOutDir();
  const started = Date.now();
  const result = await adapter.generate({
    ...request,
    prompt: prompt.trim(),
    outDir: dir,
    config: engineConfig,
    parentEnginesCfg: cfg.engines,
    onProgress,
    signal,
  });

  // An adapter may discover, from the reply, that the server dropped something
  // it had declared support for — a single-checkpoint clone answering 200 to a
  // checkpoint switch it never made. The static declaration is the promise;
  // this is the receipt.
  const ignored = [...new Set([...declaredIgnored, ...(result.unhonored || [])])];

  return {
    images: result.images || [],
    provider: selected,
    // Only claim the requested model when the adapter could actually act on
    // it: a server that hosts one checkpoint would otherwise report back the
    // name it just ignored, which reads as "your model was used".
    model: result.model
      || (adapter.supports?.includes("model") ? request.model : null)
      || null,
    prompt: prompt.trim(),
    // Redacted: the payload is up to a megabyte of base64 and this object ends
    // up in --json, in logs and in stored sessions.
    request: redactInputs(request),
    ignored,
    elapsed_ms: Date.now() - started,
    meta: result.meta || {},
  };
}

/** Engines, availability, and the configured routing — for CLI and settings. */
export async function listProviders(globalConfig) {
  const cfg = globalConfig || readConfig() || {};
  const imgCfg = imagesConfig(cfg);
  return {
    configured_provider: imgCfg.provider || "auto",
    mode: resolveMode(imgCfg),
    order: resolveChainOrder(imgCfg),
    defaults: { ...FAMILY_DEFAULTS, ...present(imgCfg.defaults) },
    engines: await listAvailableImageEngines(cfg),
  };
}

/**
 * Ask one server what it can do (models, samplers, schedulers). Returns null
 * when the engine has no catalog route or is unreachable — the settings UI
 * treats that as "type it by hand", not as an error.
 */
export async function capabilities({ provider, globalConfig } = {}) {
  const cfg = globalConfig || readConfig() || {};
  const id = provider && provider !== "auto"
    ? provider
    : (await selectImageEngine({ globalConfig: cfg })).provider;
  const adapter = getImageAdapter(id, cfg);
  if (typeof adapter.capabilities !== "function") return { provider: id, capabilities: null };
  const caps = await adapter.capabilities(providerConfig(cfg, id), cfg.engines);
  return { provider: id, capabilities: caps };
}
