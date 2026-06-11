import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { transcribe } from "#core/voice/transcription.js";

export default {
  name: "transcribe_audio",
  schema: {
    type: "function",
    function: {
      name: "transcribe_audio",
      description:
        "Transcribe an audio file to text. Default backend is local faster-whisper (model 'small' on CPU with int8 quantization, persistent server to avoid reload overhead), with automatic fallback to OpenAI Whisper API if local fails. Pass file_path for a file on disk, or base64 for raw audio bytes (will be written to a temp file). Override provider/model/language as needed.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "absolute path to audio file (.ogg, .mp3, .m4a, .wav, .webm, .opus)" },
          base64: { type: "string", description: "alternative to file_path — raw base64 audio bytes (or 'data:audio/...;base64,...' data URI)" },
          format: { type: "string", description: "file extension hint when using base64 (default 'ogg')" },
          provider: { type: "string", description: "override the configured provider: 'auto' | 'local' | 'openai'" },
          model: { type: "string", description: "local model size: tiny | base | small | medium | large | large-v2 | large-v3 (default small)" },
          language: { type: "string", description: "ISO 639-1 code (e.g. 'es', 'en') or 'auto' for detection" },
          device: { type: "string", description: "local device: cpu | cuda (default cpu)" },
          compute_type: { type: "string", description: "local quantization: int8 | int8_float16 | float16 | float32 (default int8)" },
        },
      },
    },
  },
  makeHandler: () => async ({ file_path, base64, format = "ogg", provider, model, language, device, compute_type } = {}) => {
    if (!file_path && !base64) throw new Error("transcribe_audio: file_path or base64 required");

    let pathToUse = file_path;
    let cleanupTmp = false;

    if (!pathToUse && base64) {
      const clean = String(base64).replace(/^data:audio\/[a-z]+;base64,/, "");
      const buf = Buffer.from(clean, "base64");
      const tmpDir = path.join(os.tmpdir(), "apx-transcribe");
      fs.mkdirSync(tmpDir, { recursive: true });
      const id = crypto.randomBytes(6).toString("hex");
      pathToUse = path.join(tmpDir, `audio-${id}.${String(format).replace(/^\./, "") || "ogg"}`);
      fs.writeFileSync(pathToUse, buf);
      cleanupTmp = true;
    }

    try {
      const overrides = {};
      if (provider) overrides.provider = provider;
      if (model) overrides.model = model;
      if (language) overrides.language = language;
      if (device) overrides.device = device;
      if (compute_type) overrides.compute_type = compute_type;
      return await transcribe(pathToUse, overrides);
    } finally {
      if (cleanupTmp) {
        try { fs.unlinkSync(pathToUse); } catch { /* ignore */ }
      }
    }
  },
};
