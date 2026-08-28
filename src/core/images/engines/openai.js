// OpenAI Images adapter — POST /v1/images/generations.
//
// Two lives, same code path, distinguished by whether base_url is set:
//   • stock OpenAI (gpt-image-1 / dall-e-3), keyed from engines.openai.api_key
//   • any OpenAI-compatible server, including the stable-diffusion.cpp box,
//     LocalAI, vLLM-style shims and a hosted gateway.
//
// The compatibility that makes this dialect universal is also its ceiling: the
// schema has no steps, no cfg scale, no sampler and no negative prompt. Against
// a local diffusion server that means the server's own defaults decide, and
// `z_image_turbo` at its stock 20 steps / cfg 7 took ~4× longer than the same
// picture through the A1111 route at 8 steps / cfg 1. Those knobs are declared
// unsupported here rather than silently dropped, and the facade reports them
// back so a caller can see why its `--steps` did nothing.
//
// As with TTS, a custom endpoint uses ONLY its own key: never leak the stock
// OpenAI key (or OPENAI_API_KEY) to somebody else's server.

import { postJson, getJson, probeUrl, joinUrl, writeImage, decodeBase64Image, formatSize } from "./shared.js";

const DEFAULT_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-1";
const DEFAULT_TIMEOUT_S = 600;

function getKey(config, parentEnginesCfg) {
  if (config.base_url) return config.api_key || "";
  return config.api_key || parentEnginesCfg?.openai?.api_key || process.env.OPENAI_API_KEY || "";
}

function baseFor(config) {
  return config.base_url || DEFAULT_URL;
}

function headersFor(config, parentEnginesCfg) {
  const h = {};
  const key = getKey(config, parentEnginesCfg);
  if (key) h.authorization = `Bearer ${key}`;
  return h;
}

export default {
  id: "openai",

  // No steps / cfg_scale / sampler / scheduler / negative_prompt / seed: the
  // API has nowhere to put them.
  supports: ["width", "height", "count", "model", "format"],

  async isAvailable(config = {}, parentEnginesCfg) {
    if (config.base_url) {
      return probeUrl(joinUrl(config.base_url, "/v1/models"), {
        headers: headersFor(config, parentEnginesCfg),
      });
    }
    return Boolean(getKey(config, parentEnginesCfg));
  },

  async generate({
    prompt, width, height, count, model, format,
    outDir, config = {}, parentEnginesCfg, signal,
  }) {
    const isCustom = Boolean(config.base_url);
    const key = getKey(config, parentEnginesCfg);
    if (!isCustom && !key) {
      throw new Error("openai-images: no api_key (set engines.openai.api_key or OPENAI_API_KEY)");
    }

    const body = { prompt };
    const chosenModel = model || config.model || (isCustom ? undefined : DEFAULT_MODEL);
    if (chosenModel) body.model = chosenModel;
    if (count && count > 1) body.n = count;
    if (width && height) body.size = formatSize(width, height);
    else if (config.size) body.size = config.size;
    // gpt-image-1 always answers in base64; dall-e-3 answers with a URL unless
    // asked otherwise, and a URL would leave nothing on disk.
    if (!isCustom) body.response_format = "b64_json";
    if (!isCustom && config.quality) body.quality = config.quality;
    if (isCustom && format) body.output_format = format;

    const timeoutMs = (Number(config.timeout_s) || DEFAULT_TIMEOUT_S) * 1000;
    const reply = await postJson(
      joinUrl(baseFor(config), "/v1/images/generations"),
      body,
      { headers: headersFor(config, parentEnginesCfg), signal, timeoutMs }
    );

    const entries = Array.isArray(reply?.data) ? reply.data : [];
    if (!entries.length) throw new Error("openai-images: server returned no images");

    const images = [];
    for (const [i, entry] of entries.entries()) {
      let buf;
      if (entry?.b64_json) {
        buf = decodeBase64Image(entry.b64_json);
      } else if (entry?.url) {
        // dall-e-3's default. Fetch it now: those URLs expire within the hour.
        const res = await fetch(entry.url, { signal });
        if (!res.ok) throw new Error(`openai-images: could not fetch ${res.status} from the image URL`);
        buf = Buffer.from(await res.arrayBuffer());
      } else {
        throw new Error("openai-images: reply entry carried neither b64_json nor url");
      }
      images.push(writeImage(buf, {
        outDir,
        provider: "openai",
        format: reply?.output_format || format,
        index: i,
      }));
    }

    return { images, model: chosenModel || null, meta: {} };
  },

  async capabilities(config = {}, parentEnginesCfg) {
    if (!config.base_url) {
      // Stock OpenAI: a fixed, small catalog. Listing /v1/models would return
      // every chat model too, which is noise in an image picker.
      return { models: ["gpt-image-1", "dall-e-3", "dall-e-2"], sizes: ["1024x1024", "1024x1536", "1536x1024"] };
    }
    try {
      const j = await getJson(joinUrl(config.base_url, "/v1/models"), {
        headers: headersFor(config, parentEnginesCfg),
        timeoutMs: 8000,
      });
      const models = (j?.data || []).map((m) => m.id).filter(Boolean);
      return models.length ? { models } : null;
    } catch {
      return null;
    }
  },
};
