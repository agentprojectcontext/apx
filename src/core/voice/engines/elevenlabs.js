// ElevenLabs TTS adapter.
// API docs: https://elevenlabs.io/docs/api-reference/text-to-speech
//
// Config (~/.apx/config.json → voice.tts.elevenlabs):
//   {
//     "api_key": "sk_...",         // or env ELEVENLABS_API_KEY
//     "model": "eleven_multilingual_v2",
//     "voice_id": "EXAVITQu4vr4xnSDxMaL",   // default voice (Bella)
//     "output_format": "mp3_44100_128"
//   }
//
// Returns audio as mp3 by default.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

// Reasonable Spanish-friendly default voice (multilingual model handles it).
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_FORMAT = "mp3_44100_128";

function getKey(config) {
  return config.api_key || process.env.ELEVENLABS_API_KEY || "";
}

function formatToExt(fmt) {
  if (!fmt) return "mp3";
  if (fmt.startsWith("mp3")) return "mp3";
  if (fmt.startsWith("pcm")) return "wav";
  if (fmt.startsWith("ulaw")) return "ulaw";
  if (fmt.startsWith("opus") || fmt.startsWith("ogg")) return "ogg";
  return "mp3";
}

function formatToMime(fmt) {
  const ext = formatToExt(fmt);
  return {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    ulaw: "audio/basic",
  }[ext] || "audio/mpeg";
}

export default {
  id: "elevenlabs",

  async isAvailable(config = {}) {
    return Boolean(getKey(config));
  },

  async synthesize({ text, voice, outDir, config = {}, signal }) {
    if (!text) throw new Error("elevenlabs: empty text");
    const key = getKey(config);
    if (!key) throw new Error("elevenlabs: no api_key (set ELEVENLABS_API_KEY or voice.tts.elevenlabs.api_key)");

    const voiceId = voice || config.voice_id || DEFAULT_VOICE_ID;
    const model = config.model || DEFAULT_MODEL;
    const outputFormat = config.output_format || DEFAULT_FORMAT;

    const url = `${API_BASE}/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: model,
      }),
      signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`elevenlabs ${res.status}: ${err.slice(0, 300)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());

    fs.mkdirSync(outDir, { recursive: true });
    const ext = formatToExt(outputFormat);
    const audioPath = path.join(outDir, `elevenlabs-${randomUUID()}.${ext}`);
    fs.writeFileSync(audioPath, buf);

    return {
      audio_path: audioPath,
      duration_s: null,                  // ElevenLabs doesn't return duration in this endpoint
      mime: formatToMime(outputFormat),
      provider: "elevenlabs",
    };
  },
};
