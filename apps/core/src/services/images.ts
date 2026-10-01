// Image dialects: what each kind of server expects and returns. A1111 (and Forge, SD.Next…) answers in one call;
// stable-diffusion.cpp's server queues the job and is polled; OpenAI-compatible APIs answer with base64 or a URL.
import {
  IMAGE_TIMEOUT_MS,
  type ImageOptions,
  type ImageResult,
  joinUrl,
  PROBE_TIMEOUT_MS,
  type ServiceConfig,
  ServiceError,
  sniffImage,
} from "./types.ts";

export type ImageRequest = ImageOptions & { prompt: string };

type Fetch = typeof fetch;

const POLL_MS = 1200;

const auth = (key: string | undefined): Record<string, string> =>
  key ? { authorization: `Bearer ${key}`, "x-api-key": key } : {};

async function post(f: Fetch, url: string, body: object, key: string | undefined, signal: AbortSignal) {
  const res = await f(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(key) },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

const b64 = (s: unknown) => Buffer.from(String(s).replace(/^data:[^,]+,/, ""), "base64");

async function a1111(s: ServiceConfig, r: ImageRequest, key: string | undefined, signal: AbortSignal, f: Fetch) {
  const j = await post(
    f,
    joinUrl(s.base_url, "/sdapi/v1/txt2img"),
    {
      prompt: r.prompt,
      negative_prompt: r.negative_prompt,
      width: r.width,
      height: r.height,
      steps: r.steps,
      cfg_scale: r.cfg_scale,
      seed: r.seed,
      // One image per iteration: batches multiply the GPU memory a homelab card needs.
      n_iter: r.count,
      batch_size: 1,
      ...(r.sampler ? { sampler_name: r.sampler } : {}),
      ...(s.model ? { override_settings: { sd_model_checkpoint: s.model } } : {}),
    },
    key,
    signal,
  );
  let seeds: number[] = [];
  let model: string | undefined;
  try {
    const info = JSON.parse(String(j.info ?? "{}")) as { all_seeds?: number[]; sd_model_name?: string };
    seeds = info.all_seeds ?? [];
    model = info.sd_model_name;
  } catch {}
  const images = ((j.images as unknown[]) ?? []).map((img, i) => {
    const bytes = b64(img);
    return { bytes, mime: sniffImage(bytes), seed: seeds[i] };
  });
  return { images, model };
}

async function sdcpp(s: ServiceConfig, r: ImageRequest, key: string | undefined, signal: AbortSignal, f: Fetch) {
  const job = await post(
    f,
    joinUrl(s.base_url, "/sdcpp/v1/img_gen"),
    {
      prompt: r.prompt,
      negative_prompt: r.negative_prompt,
      width: r.width,
      height: r.height,
      batch_count: r.count,
      seed: r.seed,
      output_format: "png",
      sample_params: {
        sample_steps: r.steps,
        ...(r.sampler ? { sample_method: r.sampler } : {}),
        guidance: { txt_cfg: r.cfg_scale },
      },
    },
    key,
    signal,
  );
  const id = String(job.id ?? "");
  if (!id) throw new Error("the server did not return a job id");
  const jobUrl = joinUrl(s.base_url, `/sdcpp/v1/jobs/${encodeURIComponent(id)}`);
  try {
    for (;;) {
      await wait(POLL_MS, signal);
      const res = await f(jobUrl, { headers: auth(key), signal });
      const j = (await res.json()) as {
        status?: string;
        error?: string;
        result?: { images?: Array<{ b64_json?: string }> };
      };
      if (j.status === "failed") throw new Error(j.error ?? "the job failed");
      if (j.status === "completed")
        return {
          images: (j.result?.images ?? []).map((img) => {
            const bytes = b64(img.b64_json);
            return { bytes, mime: sniffImage(bytes) };
          }),
        };
    }
  } catch (err) {
    // A job we stop waiting for keeps the GPU busy unless it is canceled.
    if (signal.aborted) void f(`${jobUrl}/cancel`, { method: "POST", headers: auth(key) }).catch(() => {});
    throw err;
  }
}

async function openaiImages(s: ServiceConfig, r: ImageRequest, key: string | undefined, signal: AbortSignal, f: Fetch) {
  const j = await post(
    f,
    joinUrl(s.base_url, "/v1/images/generations"),
    { prompt: r.prompt, n: r.count, size: `${r.width}x${r.height}`, ...(s.model ? { model: s.model } : {}) },
    key,
    signal,
  );
  const data = (j.data as Array<{ b64_json?: string; url?: string }>) ?? [];
  const images = await Promise.all(
    data.map(async (d) => {
      const bytes = d.b64_json
        ? b64(d.b64_json)
        : Buffer.from(await (await f(String(d.url), { signal })).arrayBuffer());
      return { bytes, mime: sniffImage(bytes) };
    }),
  );
  return { images, model: s.model };
}

/** Waits between polls; rejects as soon as the call is canceled. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop() {
      clearTimeout(t);
      reject(signal.reason);
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}

const DIALECTS = { a1111, sdcpp, "openai-images": openaiImages } as const;

/** Draws with one service; throws a ServiceError saying which service failed and why. */
export async function generateImage(
  s: ServiceConfig,
  r: ImageRequest,
  key: string | undefined,
  signal: AbortSignal,
  f: Fetch = fetch,
): Promise<ImageResult> {
  const dialect = DIALECTS[s.dialect as keyof typeof DIALECTS];
  if (!dialect) throw new ServiceError(s.label, `not an image service (${s.dialect})`);
  try {
    const r2 = await dialect(s, r, key, AbortSignal.any([signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)]), f);
    if (!r2.images.length) throw new Error("no image came back");
    return r2;
  } catch (err) {
    throw new ServiceError(s.label, err instanceof Error ? err.message : String(err));
  }
}

/** The endpoint that answers quickly when the server is up, per dialect. */
export const IMAGE_PROBE: Record<string, string> = {
  a1111: "/sdapi/v1/options",
  sdcpp: "/sdcpp/v1/capabilities",
  "openai-images": "/v1/models",
};

export async function probe(
  s: ServiceConfig,
  path: string,
  key: string | undefined,
  f: Fetch = fetch,
): Promise<boolean> {
  try {
    const res = await f(joinUrl(s.base_url, path), {
      headers: auth(key),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}
