// AUTOMATIC1111-compatible adapter — POST /sdapi/v1/txt2img, synchronous.
//
// The most widely spoken text-to-image dialect there is: A1111 itself, Forge,
// SD.Next, Draw Things on macOS, and the stable-diffusion.cpp server all
// answer on it. One adapter therefore covers "the homelab box" and "a local
// Mac server" with nothing different but a base_url.
//
// Synchronous: the request stays open for the whole generation and the reply
// carries the images as base64. That is why it has no progress callback — the
// server sends nothing until it is done. For a long queue prefer the sdcpp
// adapter, which polls instead of holding a socket open.
//
// Shape of the reply (verified against stable-diffusion.cpp's shim):
//   { images: ["<base64 png>", …], info: "<json string>", parameters: {…} }
// `info` is a JSON *string* (not an object) and carries the resolved seed —
// the only way to learn which seed a `seed: -1` request actually used.
//
// ── img2img ────────────────────────────────────────────────────────────────
// An `init_image` switches the route to POST /sdapi/v1/img2img, where the
// picture is the starting canvas rather than a structural hint: the reply keeps
// the same envelope, so only the URL and two fields differ. `denoising_strength`
// is how far the sampler is allowed to walk away from it — ~0.3 retouches,
// ~0.45 is the useful middle, >0.6 reinvents the scene. Verified against
// stable-diffusion.cpp at 512x768.
//
// ── Inpainting ─────────────────────────────────────────────────────────────
// A `mask` alongside the init image confines the repaint to the white areas
// and leaves the black ones byte-identical, which is the only way to change one
// thing in a picture and keep the rest of the scene. Verified against
// stable-diffusion.cpp's shim.
//
// `inpainting_fill` decides what the masked region starts from, and it is the
// setting that decides whether the prompt lands at all:
//   1 "original" (default) keeps the existing pixels — a gentle edit, but on a
//     turbo checkpoint at cfg 1.0 the old content can outvote the prompt
//     entirely and nothing visibly changes;
//   2 "latent noise" throws them away, which is what a prompt that has to
//     override the region needs.
// Measured on Z-Image Turbo: fill 1 at denoise 0.75 left a green body green;
// fill 2 at denoise 1.0 turned it red with the rest of the frame untouched.
//
// Structural conditioning (ControlNet) is NOT here: that server takes a
// `control_image` on its own native route, so it lives in the sdcpp adapter.

import { postJson, probeUrl, joinUrl, writeImage, decodeBase64Image, toRawBase64, imageSize } from "./shared.js";

const DEFAULT_TIMEOUT_S = 600;

function headersFor(config) {
  const h = {};
  if (config.api_key) h.authorization = `Bearer ${config.api_key}`;
  return h;
}

/**
 * Is `asked` the checkpoint the server says it `rendered` with? Compared
 * loosely on purpose: a server reports "z_image_turbo-Q4_K.gguf" for what a
 * person types as "z_image_turbo-Q4_K", and a strict compare would cry wolf on
 * every correct request.
 */
function sameCheckpoint(asked, rendered) {
  if (!asked || !rendered) return false;
  const norm = (v) => String(v).toLowerCase().replace(/\.(gguf|safetensors|ckpt|pt)$/, "").trim();
  const a = norm(asked);
  const r = norm(rendered);
  return a === r || r.includes(a) || a.includes(r);
}

/** The resolved seed hides inside a JSON string; a malformed one is not fatal. */
function parseInfo(info) {
  if (!info) return null;
  if (typeof info === "object") return info;
  try { return JSON.parse(info); } catch { return null; }
}

export default {
  id: "a1111",

  // Everything in the family contract except `format`: the A1111 API has no
  // output-format field — the server decides (PNG in practice) and we sniff
  // the real container from the bytes rather than trusting a request that was
  // never sent.
  //
  // `model` is listed, but it is the one entry this adapter cannot promise
  // STATICALLY. Real A1111 and Forge switch checkpoints through
  // override_settings; a single-checkpoint clone accepts the field, answers
  // 200, and renders with whatever it loaded at launch — measured against
  // stable-diffusion.cpp, which happily took a checkpoint name that does not
  // exist. So the promise is verified per RESPONSE instead: `info` names the
  // model that actually rendered, and generate() reports `model` as unhonored
  // when that is not the one asked for. Declaring it here is right for the
  // dialect; the per-response check is what keeps it honest per server.
  supports: [
    "negative_prompt", "width", "height", "steps", "cfg_scale",
    "seed", "sampler", "scheduler", "count", "model",
    "init_image", "denoising_strength",
    "mask", "mask_blur", "inpainting_fill", "inpaint_full_res",
  ],

  async isAvailable(config = {}) {
    if (!config.base_url) return false;
    // /sdapi/v1/options is the cheapest route every A1111 clone implements.
    // A server that answers 404 there but serves txt2img still counts as
    // reachable, so fall back to the root document before giving up.
    return (
      (await probeUrl(joinUrl(config.base_url, "/sdapi/v1/options"))) ||
      (await probeUrl(joinUrl(config.base_url, "/")))
    );
  },

  async generate({
    prompt, negative_prompt, width, height, steps, cfg_scale, seed,
    sampler, scheduler, count, model, format, outDir, config = {}, signal,
    init_image, denoising_strength,
    mask, mask_blur, inpainting_fill, inpaint_full_res,
  }) {
    if (!config.base_url) throw new Error("a1111: base_url required");

    // A mask with nothing to mask is a request that would render a plain
    // txt2img and look like the mask was ignored. Refuse instead.
    if (mask && !init_image) {
      throw new Error("a1111: mask needs an init image — inpainting repaints part of a picture");
    }
    const img2img = !!init_image;
    const body = { prompt };
    if (negative_prompt) body.negative_prompt = negative_prompt;
    if (width) body.width = width;
    if (height) body.height = height;
    if (steps) body.steps = steps;
    if (cfg_scale != null) body.cfg_scale = cfg_scale;
    if (seed != null) body.seed = seed;
    if (sampler) body.sampler_name = sampler;
    if (scheduler) body.scheduler = scheduler;
    if (count && count > 1) { body.n_iter = count; body.batch_size = 1; }
    // A1111 switches checkpoints through override_settings, not a top-level
    // field. Servers that host a single model (sd.cpp) ignore it harmlessly.
    if (model) body.override_settings = { sd_model_checkpoint: model };

    // img2img carries the canvas plus how far the sampler may stray from it.
    // The field is `init_images` (plural, an array) even for a single picture —
    // an `init_image` singular is silently ignored and you get plain txt2img.
    if (img2img) {
      body.init_images = [toRawBase64(init_image)];
      body.denoising_strength = denoising_strength != null ? denoising_strength : 0.45;
    }

    if (mask) {
      const initBuf = decodeBase64Image(init_image);
      const maskBuf = decodeBase64Image(mask);
      const a = imageSize(initBuf);
      const b = imageSize(maskBuf);
      // Servers accept a mismatched mask without complaint and then inpaint the
      // wrong region (or nothing), so catch it here where the fix is sayable.
      if (a && b && (a.width !== b.width || a.height !== b.height)) {
        throw new Error(
          `a1111: mask is ${b.width}x${b.height} but the init image is ${a.width}x${a.height} — ` +
          "they must match exactly; resize the mask first"
        );
      }
      body.mask = toRawBase64(mask);
      if (mask_blur != null) body.mask_blur = mask_blur;
      body.inpainting_fill = inpainting_fill != null ? inpainting_fill : 1;
      body.inpaint_full_res = inpaint_full_res != null ? inpaint_full_res : false;
    }

    const timeoutMs = (Number(config.timeout_s) || DEFAULT_TIMEOUT_S) * 1000;
    const reply = await postJson(
      joinUrl(config.base_url, img2img ? "/sdapi/v1/img2img" : "/sdapi/v1/txt2img"),
      body,
      { headers: headersFor(config), signal, timeoutMs }
    );

    const b64s = Array.isArray(reply?.images) ? reply.images : [];
    if (!b64s.length) throw new Error("a1111: server returned no images");

    const info = parseInfo(reply?.info);
    const seeds = Array.isArray(info?.all_seeds) ? info.all_seeds : [];
    const rendered = info?.sd_model_name || null;

    return {
      images: b64s.map((b64, i) =>
        ({ ...writeImage(decodeBase64Image(b64), { outDir, provider: "a1111", format, index: i }),
           seed: seeds[i] ?? info?.seed ?? (seed >= 0 ? seed : null) })),
      // Report the model that RENDERED, never the one that was asked for — a
      // server that ignored the request must not have its silence read as
      // agreement.
      model: rendered || (sameCheckpoint(model, rendered) ? model : null) || null,
      unhonored: model && rendered && !sameCheckpoint(model, rendered) ? ["model"] : [],
      meta: {
        mode: mask ? "inpaint" : img2img ? "img2img" : "txt2img",
        sampler: info?.sampler_name || sampler || null,
        steps: info?.steps ?? steps ?? null,
        cfg_scale: info?.cfg_scale ?? cfg_scale ?? null,
        ...(img2img ? { denoising_strength: body.denoising_strength } : {}),
        ...(mask ? { inpainting_fill: body.inpainting_fill, mask_blur: body.mask_blur ?? null } : {}),
      },
    };
  },

  /** Live catalog for the settings UI: which checkpoints and samplers exist. */
  async capabilities(config = {}) {
    if (!config.base_url) return null;
    const out = {};
    const pull = async (route, shape) => {
      try {
        const res = await fetch(joinUrl(config.base_url, route), { headers: headersFor(config) });
        if (!res.ok) return;
        Object.assign(out, shape(await res.json()));
      } catch { /* a missing sub-route is normal on minimal clones */ }
    };
    await pull("/sdapi/v1/sd-models", (j) =>
      ({ models: (j || []).map((m) => m.model_name || m.title).filter(Boolean) }));
    await pull("/sdapi/v1/samplers", (j) =>
      ({ samplers: (j || []).map((s) => s.name).filter(Boolean) }));
    await pull("/sdapi/v1/schedulers", (j) =>
      ({ schedulers: (j || []).map((s) => s.name || s.label).filter(Boolean) }));
    return Object.keys(out).length ? out : null;
  },
};
