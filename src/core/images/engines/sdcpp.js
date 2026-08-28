// stable-diffusion.cpp native adapter — asynchronous job + polling.
//
//   POST /sdcpp/v1/img_gen        → { id, poll_url, status: "queued" }
//   GET  /sdcpp/v1/jobs/<id>      → { status, queue_position, result, error }
//   POST /sdcpp/v1/jobs/<id>/cancel
//   GET  /sdcpp/v1/capabilities   → model, samplers, schedulers, defaults, limits
//
// Statuses seen from the server: queued → generating → completed (or failed,
// with `error` set). The finished job carries
//   result: { images: [{ b64_json }], output_format: "png" }
//
// This is the adapter to prefer for anything unattended. The A1111 route holds
// one socket open for the whole render, so a queued job behind someone else's
// batch looks like a hung request; here the socket closes immediately and the
// caller polls, which also means we can report queue position while waiting.
//
// One model per server: stable-diffusion.cpp loads a checkpoint at launch, so
// there is no field to switch it and `model` is declared unsupported rather
// than quietly ignored.

import { postJson, getJson, probeUrl, joinUrl, trimBase, writeImage, decodeBase64Image } from "./shared.js";

const DEFAULT_POLL_MS = 1200;
const DEFAULT_TIMEOUT_S = 900;
const TERMINAL_OK = new Set(["completed", "succeeded", "success", "done"]);
const TERMINAL_BAD = new Set(["failed", "error", "cancelled", "canceled"]);

function headersFor(config) {
  const h = {};
  if (config.api_key) h.authorization = `Bearer ${config.api_key}`;
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The server hands back a relative poll_url ("/sdcpp/v1/jobs/<id>"). Honor it
 * rather than rebuilding the path: a server behind a sub-path proxy tells us
 * where it really lives, and reconstructing would send us to a 404.
 */
function pollUrlFor(config, submitted) {
  const rel = submitted?.poll_url;
  if (typeof rel === "string" && rel.startsWith("/")) return trimBase(config.base_url) + rel;
  if (typeof rel === "string" && /^https?:/i.test(rel)) return rel;
  return joinUrl(config.base_url, `/sdcpp/v1/jobs/${submitted?.id}`);
}

/** Pull the base64 images out of whichever envelope the build uses. */
function imagesFrom(result) {
  if (!result) return [];
  const list = result.images || result.data || [];
  return list
    .map((item) => (typeof item === "string" ? item : item?.b64_json || item?.b64 || item?.image))
    .filter(Boolean);
}

export default {
  id: "sdcpp",

  // `model` is absent on purpose — see the header.
  supports: [
    "negative_prompt", "width", "height", "steps", "cfg_scale",
    "seed", "sampler", "scheduler", "count", "format",
  ],

  async isAvailable(config = {}) {
    if (!config.base_url) return false;
    return probeUrl(joinUrl(config.base_url, "/sdcpp/v1/capabilities"), {
      headers: headersFor(config),
    });
  },

  async generate({
    prompt, negative_prompt, width, height, steps, cfg_scale, seed,
    sampler, scheduler, count, format, outDir, config = {}, signal, onProgress,
  }) {
    if (!config.base_url) throw new Error("sdcpp: base_url required");

    const sample_params = {};
    if (steps) sample_params.sample_steps = steps;
    if (sampler) sample_params.sample_method = sampler;
    if (scheduler) sample_params.scheduler = scheduler;
    if (cfg_scale != null) sample_params.guidance = { txt_cfg: cfg_scale };

    const body = { prompt };
    if (negative_prompt) body.negative_prompt = negative_prompt;
    if (width) body.width = width;
    if (height) body.height = height;
    if (count) body.batch_count = count;
    if (seed != null) body.seed = seed;
    if (format) body.output_format = format;
    if (Object.keys(sample_params).length) body.sample_params = sample_params;

    const submitted = await postJson(
      joinUrl(config.base_url, "/sdcpp/v1/img_gen"),
      body,
      { headers: headersFor(config), signal, timeoutMs: 60_000 }
    );
    if (!submitted?.id) throw new Error("sdcpp: server did not return a job id");

    const pollUrl = pollUrlFor(config, submitted);
    const intervalMs = Number(config.poll_interval_ms) || DEFAULT_POLL_MS;
    const deadline = Date.now() + (Number(config.timeout_s) || DEFAULT_TIMEOUT_S) * 1000;

    let job = submitted;
    while (true) {
      if (signal?.aborted) {
        // Best-effort: tell the server to stop burning GPU on a job nobody
        // is waiting for any more. Failure here is not worth surfacing.
        fetch(`${pollUrl}/cancel`, { method: "POST", headers: headersFor(config) }).catch(() => {});
        throw new Error("sdcpp: cancelled");
      }
      if (Date.now() > deadline) {
        fetch(`${pollUrl}/cancel`, { method: "POST", headers: headersFor(config) }).catch(() => {});
        throw new Error(`sdcpp: job ${submitted.id} timed out`);
      }
      await sleep(intervalMs);

      try {
        job = await getJson(pollUrl, { headers: headersFor(config), timeoutMs: 30_000 });
      } catch (e) {
        // A restarting server drops its job table and answers "job not found".
        // Say so plainly — the generic 4xx text sends people hunting for a bug
        // in the request instead of looking at the box.
        if (/not found/i.test(e.message)) {
          throw new Error(`sdcpp: job ${submitted.id} disappeared (the server restarted mid-render)`);
        }
        throw e;
      }

      const status = String(job?.status || "").toLowerCase();
      if (onProgress) onProgress({ status, queue_position: job?.queue_position ?? null });
      if (TERMINAL_BAD.has(status)) {
        throw new Error(`sdcpp: job ${status}${job?.error ? ` — ${job.error}` : ""}`);
      }
      if (TERMINAL_OK.has(status)) break;
    }

    const b64s = imagesFrom(job?.result);
    if (!b64s.length) throw new Error("sdcpp: job completed with no images");
    const outFormat = job?.result?.output_format || format;

    return {
      images: b64s.map((b64, i) =>
        ({ ...writeImage(decodeBase64Image(b64), { outDir, provider: "sdcpp", format: outFormat, index: i }),
           seed: seed >= 0 ? seed : null })),
      model: null, // filled in by the facade from capabilities() when known
      meta: { job_id: submitted.id, elapsed_s: job?.completed && job?.started ? job.completed - job.started : null },
    };
  },

  /**
   * The richest catalog of the three adapters: the settings UI reads samplers,
   * schedulers and the server's own defaults straight off it, so nothing has
   * to be hardcoded per install.
   */
  async capabilities(config = {}) {
    if (!config.base_url) return null;
    try {
      const caps = await getJson(joinUrl(config.base_url, "/sdcpp/v1/capabilities"), {
        headers: headersFor(config),
        timeoutMs: 8000,
      });
      if (!caps) return null;
      return {
        models: caps.model ? [caps.model.stem || caps.model.name].filter(Boolean) : [],
        samplers: caps.samplers || [],
        schedulers: caps.schedulers || [],
        defaults: caps.defaults || null,
        modes: caps.supported_modes || [],
        formats: caps.output_formats_by_mode?.img_gen || caps.output_formats || [],
      };
    } catch {
      return null;
    }
  },
};
