// OpenAI TTS adapter (tts-1 / tts-1-hd) — and any OpenAI-compatible endpoint.
// Docs: https://platform.openai.com/docs/api-reference/audio/createSpeech
//
// Reuses engines.openai.api_key from ~/.apx/config.json. Per-engine voice
// config (~/.apx/config.json → voice.tts.openai) can override model/voice.
//
// Custom endpoint ("QVox custom"): set voice.tts.openai.base_url to a local
// OpenAI-compatible speech server (e.g. a Qwen3-TTS / QVox daemon at
// http://127.0.0.1:5111/v1). When base_url is set we additionally forward the
// non-OpenAI fields that server understands — `instruct` (the base voice, from
// the `style` arg), `language`, `clone`/`ref_text` and `temperature`. These
// extras are NEVER sent to stock OpenAI (only when base_url is present), so the
// standard path stays byte-for-byte compatible.
//
// Which of `clone` / `voice` / `instruct` is set decides HOW the server speaks,
// and they are not additive — QVox reads them in that order and the first one
// wins. A named speaker carries its own accent, so picking one leaves `style`
// describing only the delivery; only a cloned reference can carry an accent no
// preset speaker has.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_API_URL = "https://api.openai.com/v1/audio/speech";
const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";          // alloy|echo|fable|onyx|nova|shimmer

function getKey(config, parentEnginesCfg) {
  // A custom endpoint uses ONLY its own key (often none); never leak the stock
  // OpenAI engine key / OPENAI_API_KEY env to a third-party server.
  if (config.base_url) return config.api_key || "";
  return (
    config.api_key ||
    parentEnginesCfg?.openai?.api_key ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

function endpoint(config) {
  if (config.base_url) {
    return config.base_url.replace(/\/+$/, "") + "/audio/speech";
  }
  return DEFAULT_API_URL;
}

function mimeFor(format) {
  return {
    mp3: "audio/mpeg",
    opus: "audio/ogg",
    aac: "audio/aac",
    flac: "audio/flac",
    wav: "audio/wav",
    pcm: "audio/L16",
  }[format] || "audio/mpeg";
}

export default {
  id: "openai",

  async isAvailable(config = {}, parentEnginesCfg) {
    // A custom endpoint is assumed reachable (it may be keyless/open like QVox);
    // stock OpenAI needs a key.
    return Boolean(config.base_url) || Boolean(getKey(config, parentEnginesCfg));
  },

  // Only local endpoints have anything to warm. A cloud API is as ready as it
  // will ever be, and a hosted server is not ours to spin up — so a stock
  // OpenAI config skips instead of sending a pointless request.
  async warmup(config = {}) {
    if (!config.base_url) return { ok: true, skipped: "not a local endpoint" };
    const url = config.base_url.replace(/\/+$/, "") + "/warmup";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.api_key ? { authorization: `Bearer ${config.api_key}` } : {}),
      },
      // Say which voice, so the endpoint warms the model that will answer
      // rather than a sibling of it — these are different multi-gigabyte
      // checkpoints, and warming one leaves the other exactly as cold. The
      // clone is named for the same reason: a cloned reference is served by a
      // third checkpoint again, so a warmup that only ever mentions `voice`
      // warms nothing the next request will use.
      body: JSON.stringify({
        ...(config.voice ? { voice: config.voice } : {}),
        ...(config.clone ? { clone: config.clone, ref_text: config.ref_text } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`warmup ${res.status}`);
    return await res.json().catch(() => ({ ok: true }));
  },

  async synthesize({ text, voice, language, style, outDir, config = {}, format, signal, parentEnginesCfg }) {
    if (!text) throw new Error("openai-tts: empty text");
    const isCustom = Boolean(config.base_url);
    const key = getKey(config, parentEnginesCfg);
    if (!isCustom && !key) {
      throw new Error("openai-tts: no api_key (set OPENAI_API_KEY or engines.openai.api_key)");
    }

    const url = endpoint(config);
    const model = config.model || (isCustom ? undefined : DEFAULT_MODEL);
    const chosenVoice = voice || config.voice || (isCustom ? undefined : DEFAULT_VOICE);
    const responseFormat = format || config.format || (isCustom ? "wav" : "mp3");
    const styleHint = String(style ?? config.style ?? "").trim();

    const body = { input: text, response_format: responseFormat };
    if (model) body.model = model;
    if (chosenVoice) body.voice = chosenVoice;
    if (isCustom) {
      // QVox / Qwen3-TTS extras (ignored by stock OpenAI, so only sent here).
      if (styleHint) body.instruct = styleHint;
      // A caller that names a language wins; otherwise the configured one.
      // Nothing in the speaking path (Telegram voice notes, the desktop, a
      // routine) passes one, so without this the server was left to guess from
      // its own default — right by luck here, wrong for anyone whose local
      // server defaults elsewhere.
      const lang = language || config.language;
      if (lang && lang !== "auto") body.language = lang;
      // Voice cloning: the endpoint reads the reference itself, so this is a
      // path on ITS filesystem, not ours. `ref_text` is what the recording
      // says — optional, and worth setting: telling the model that measured
      // 15.8 chars/s against 12.9 without it.
      if (config.clone) body.clone = config.clone;
      if (config.ref_text) body.ref_text = config.ref_text;
      if (config.temperature != null) body.temperature = config.temperature;
    } else if (styleHint && /gpt-4o.*tts/i.test(model || "")) {
      // Stock OpenAI's newer TTS models accept a natural-language `instructions`.
      body.instructions = styleHint;
    }

    const headers = { "content-type": "application/json" };
    if (key) {
      headers.authorization = `Bearer ${key}`;
      if (isCustom) headers["x-api-key"] = key; // QVox accepts either header.
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`openai-tts ${res.status}: ${err.slice(0, 300)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());

    fs.mkdirSync(outDir, { recursive: true });
    const audioPath = path.join(outDir, `openai-${randomUUID()}.${responseFormat}`);
    fs.writeFileSync(audioPath, buf);

    return {
      audio_path: audioPath,
      duration_s: null,
      mime: mimeFor(responseFormat),
      provider: "openai",
    };
  },
};
