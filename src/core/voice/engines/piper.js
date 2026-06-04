// Piper TTS adapter — local, offline, no API key.
// Calls the `piper` CLI (https://github.com/rhasspy/piper). Requires the user
// to have installed piper and at least one voice model (.onnx + .onnx.json).
//
// Config (~/.apx/config.json → voice.tts.piper):
//   {
//     "bin": "piper",                 // override binary path/name
//     "model": "/abs/path/to/<voice>.onnx",
//     "speaker": 0,                   // optional speaker id for multi-voice models
//     "extra_args": []                // raw extra CLI args
//   }
//
// Detection is graceful: isAvailable() returns false when piper is not on PATH
// or no model is configured. Selector then falls back to other engines.

import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

function which(bin) {
  return new Promise((resolve) => {
    execFile("which", [bin], (err, stdout) => {
      if (err) return resolve(null);
      const out = String(stdout || "").trim();
      resolve(out || null);
    });
  });
}

export default {
  id: "piper",

  async isAvailable(config = {}) {
    const bin = config.bin || "piper";
    if (!(await which(bin))) return false;
    if (config.model && !fs.existsSync(config.model)) return false;
    return true;
  },

  async synthesize({ text, voice, outDir, config = {}, format = "wav" }) {
    if (!text) throw new Error("piper: empty text");
    const bin = config.bin || "piper";
    const model = voice || config.model;
    if (!model) {
      throw new Error("piper: no model configured (set voice.tts.piper.model in ~/.apx/config.json)");
    }
    if (!fs.existsSync(model)) {
      throw new Error(`piper: model not found at ${model}`);
    }

    fs.mkdirSync(outDir, { recursive: true });
    const audioPath = path.join(outDir, `piper-${randomUUID()}.${format === "wav" ? "wav" : "wav"}`);

    const args = ["--model", model, "--output_file", audioPath];
    if (config.speaker !== undefined && config.speaker !== null && config.speaker !== "") {
      args.push("--speaker", String(config.speaker));
    }
    if (Array.isArray(config.extra_args)) args.push(...config.extra_args.map(String));

    await new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (c) => { stderr += c.toString(); });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) return resolve();
        reject(new Error(`piper exited ${code}: ${stderr.slice(0, 300)}`));
      });
      proc.stdin.end(text);
    });

    // Best-effort duration estimate from WAV header.
    let duration = 0;
    try {
      const fd = fs.openSync(audioPath, "r");
      const head = Buffer.alloc(44);
      fs.readSync(fd, head, 0, 44, 0);
      fs.closeSync(fd);
      const sampleRate = head.readUInt32LE(24);
      const byteRate = head.readUInt32LE(28);
      const dataSize = fs.statSync(audioPath).size - 44;
      if (sampleRate && byteRate) duration = dataSize / byteRate;
    } catch { /* ignore */ }

    return {
      audio_path: audioPath,
      duration_s: duration || null,
      mime: "audio/wav",
      provider: "piper",
    };
  },
};
