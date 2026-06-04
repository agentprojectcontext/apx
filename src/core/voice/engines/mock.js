// Mock TTS engine. Writes a tiny placeholder WAV (silent) so callers get a real
// playable file without external dependencies. Used in tests and as a fallback
// when no real engine is configured.
//
// The "audio" produced is a minimally valid 8 kHz mono PCM-16 WAV with `n_ms`
// milliseconds of silence so duration_s is meaningful. Total size grows with
// text length so different inputs produce different files (handy in tests).

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

function buildSilentWav(ms) {
  const sampleRate = 8000;
  const numSamples = Math.max(1, Math.floor((sampleRate * ms) / 1000));
  const byteRate = sampleRate * 2;       // 16-bit mono
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);             // PCM chunk size
  buf.writeUInt16LE(1, 20);              // PCM format
  buf.writeUInt16LE(1, 22);              // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32);              // block align
  buf.writeUInt16LE(16, 34);             // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  // samples already zero-filled by Buffer.alloc → silence
  return buf;
}

export default {
  id: "mock",

  async isAvailable() {
    return true;
  },

  async synthesize({ text, outDir, format = "wav" }) {
    if (!text) throw new Error("mock-tts: empty text");
    // Roughly 60 ms per character — gives test assertions something to check.
    const durationMs = Math.max(100, Math.min(60_000, text.length * 60));
    const wav = buildSilentWav(durationMs);
    const filename = `mock-${randomUUID()}.${format === "wav" ? "wav" : "wav"}`;
    fs.mkdirSync(outDir, { recursive: true });
    const audioPath = path.join(outDir, filename);
    fs.writeFileSync(audioPath, wav);
    return {
      audio_path: audioPath,
      duration_s: durationMs / 1000,
      mime: "audio/wav",
      provider: "mock",
    };
  },
};
