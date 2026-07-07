// Gemini TTS adapter.
// The Gemini TTS surface can vary across SDK versions: some models
// (gemini-2.5-flash-tts) expose synthesize via the v1beta REST surface, others
// require Vertex. To keep APX engine-agnostic, this adapter performs a
// best-effort call against the documented REST shape, but flags itself as
// not-implemented when the response does not include inline audio data.
//
// Config (~/.apx/config.json → voice.tts.gemini):
//   { "api_key": "...", "model": "gemini-2.5-flash-tts", "voice": "Kore",
//     "style": "habla en tono alegre y enérgico" }
//
// `style` is an optional natural-language instruction describing HOW the voice
// should speak. Gemini single-speaker TTS controls delivery by prefixing the
// text with such an instruction, so we prepend "<style>: <text>" before
// synthesizing. A per-call `style` arg overrides the saved config.style.
//
// If you need a guaranteed-working Gemini TTS path today, prefer ElevenLabs or
// OpenAI engines and revisit this once Google stabilises the API.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_MODEL = "gemini-2.5-flash-tts";

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

  async synthesize({ text, voice, style, outDir, config = {}, signal, parentEnginesCfg }) {
    if (!text) throw new Error("gemini-tts: empty text");
    const key = getKey(config, parentEnginesCfg);
    if (!key) throw new Error("gemini-tts: no api_key (set GEMINI_API_KEY or engines.gemini.api_key)");

    const model = config.model || DEFAULT_MODEL;
    const voiceName = voice || config.voice || "Kore";

    // Speaking-style instruction: per-call `style` wins over saved config.style.
    const styleHint = (style ?? config.style ?? "").trim();
    const promptText = styleHint ? `${styleHint}: ${text}` : text;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const body = {
      contents: [{ parts: [{ text: promptText }] }],
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
    const rawBuf = Buffer.from(inline.data, "base64");

    // Gemini commonly returns mime like "audio/L16;codec=pcm;rate=24000" —
    // raw signed 16-bit little-endian PCM with no RIFF header. macOS afplay
    // and most other players won't decode it. Wrap it in a WAV container if
    // the mime signals PCM; pass through anything that's already a container.
    const isRawPcm = /audio\/L16|audio\/pcm|codec=pcm/i.test(mime);
    const isOgg   = /audio\/ogg/i.test(mime);
    const isMpeg  = /audio\/mpeg/i.test(mime);

    let buf = rawBuf;
    let ext = "wav";
    let outMime = mime;
    if (isMpeg)      { ext = "mp3"; outMime = "audio/mpeg"; }
    else if (isOgg)  { ext = "ogg"; outMime = "audio/ogg"; }
    else if (isRawPcm || !/audio\/wav|audio\/x-wav/i.test(mime)) {
      // Default any unknown / L16 mime to wrapped WAV.
      const rateMatch = /rate=(\d+)/i.exec(mime || "");
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
      buf = wrapPcmAsWav(rawBuf, { sampleRate, channels: 1, bitsPerSample: 16 });
      ext = "wav";
      outMime = "audio/wav";
    }

    fs.mkdirSync(outDir, { recursive: true });
    const audioPath = path.join(outDir, `gemini-${randomUUID()}.${ext}`);
    fs.writeFileSync(audioPath, buf);

    return {
      audio_path: audioPath,
      duration_s: null,
      mime: outMime,
      provider: "gemini",
    };
  },
};

// Build a minimal 44-byte RIFF/WAVE header for signed PCM and prepend it to
// `pcm`. Used when an engine (today: Gemini) returns raw L16 PCM bytes that
// players can't decode without a container.
function wrapPcmAsWav(pcm, { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);          // PCM fmt chunk size
  header.writeUInt16LE(1, 20);           // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
