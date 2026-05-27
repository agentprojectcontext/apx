// Gemini TTS adapter.
// At the time of writing the Gemini TTS surface is gated and not stable across
// SDK versions: some models (gemini-2.5-flash-preview-tts) expose synthesize
// via the v1beta REST surface, others require Vertex. To keep APX engine-
// agnostic, this adapter performs a best-effort call against the documented
// REST shape, but flags itself as not-implemented when the response does not
// include inline audio data.
//
// Config (~/.apx/config.json → voice.tts.gemini):
//   { "api_key": "...", "model": "gemini-2.5-flash-preview-tts", "voice": "Kore" }
//
// If you need a guaranteed-working Gemini TTS path today, prefer ElevenLabs or
// OpenAI engines and revisit this once Google stabilises the API.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";

function getKey(config, parentEnginesCfg) {
  return (
    config.api_key ||
    parentEnginesCfg?.gemini?.api_key ||
    process.env.GEMINI_API_KEY ||
    ""
  );
}

export default {
  id: "gemini",

  async isAvailable(config = {}, parentEnginesCfg) {
    // Marked "available" if a key exists — but synthesize() may still throw
    // not-implemented if the SDK surface changes. Selector will fall back.
    return Boolean(getKey(config, parentEnginesCfg));
  },

  async synthesize({ text, voice, outDir, config = {}, signal, parentEnginesCfg }) {
    if (!text) throw new Error("gemini-tts: empty text");
    const key = getKey(config, parentEnginesCfg);
    if (!key) throw new Error("gemini-tts: no api_key (set GEMINI_API_KEY or engines.gemini.api_key)");

    const model = config.model || DEFAULT_MODEL;
    const voiceName = voice || config.voice || "Kore";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const body = {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`gemini-tts: not implemented for this account/model (status ${res.status}). Details: ${err.slice(0, 200)}`);
    }
    const json = await res.json().catch(() => ({}));
    // The REST surface returns inlineData.data (base64) + mimeType.
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const inline = audioPart?.inlineData || audioPart?.inline_data;
    if (!inline?.data) {
      throw new Error("gemini-tts: not implemented (response did not include inline audio data)");
    }
    const mime = inline.mimeType || inline.mime_type || "audio/wav";
    const ext = mime.includes("mpeg") ? "mp3" : mime.includes("ogg") ? "ogg" : "wav";
    const buf = Buffer.from(inline.data, "base64");

    fs.mkdirSync(outDir, { recursive: true });
    const audioPath = path.join(outDir, `gemini-${randomUUID()}.${ext}`);
    fs.writeFileSync(audioPath, buf);

    return {
      audio_path: audioPath,
      duration_s: null,
      mime,
      provider: "gemini",
    };
  },
};
