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
// the `style` arg), `language` and `temperature`. These extras are NEVER sent
// to stock OpenAI (only when base_url is present), so the standard path stays
// byte-for-byte compatible.

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
      if (language) body.language = language;
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
