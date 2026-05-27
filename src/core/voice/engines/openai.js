// OpenAI TTS adapter (tts-1 / tts-1-hd).
// Docs: https://platform.openai.com/docs/api-reference/audio/createSpeech
//
// Reuses engines.openai.api_key from ~/.apx/config.json. Per-engine voice
// config (~/.apx/config.json → voice.tts.openai) can override model/voice.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const API_URL = "https://api.openai.com/v1/audio/speech";
const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";          // alloy|echo|fable|onyx|nova|shimmer

function getKey(config, parentEnginesCfg) {
  return (
    config.api_key ||
    parentEnginesCfg?.openai?.api_key ||
    process.env.OPENAI_API_KEY ||
    ""
  );
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
    return Boolean(getKey(config, parentEnginesCfg));
  },

  async synthesize({ text, voice, outDir, config = {}, format, signal, parentEnginesCfg }) {
    if (!text) throw new Error("openai-tts: empty text");
    const key = getKey(config, parentEnginesCfg);
    if (!key) throw new Error("openai-tts: no api_key (set OPENAI_API_KEY or engines.openai.api_key)");

    const model = config.model || DEFAULT_MODEL;
    const chosenVoice = voice || config.voice || DEFAULT_VOICE;
    const responseFormat = format || config.format || "mp3";

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice: chosenVoice,
        input: text,
        response_format: responseFormat,
      }),
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
