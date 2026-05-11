// daemon/transcription.js
// Audio transcription dispatcher. Two backends:
//
//   - LOCAL (faster-whisper via Python subprocess) — ported from Panda's
//     transcription_service.py. Same defaults: model "medium", device "cpu",
//     compute_type "int8", beam_size 5, auto language detection. Requires
//     `pip3 install faster-whisper` on the host.
//
//   - OPENAI (Whisper-1 cloud API) — needs OPENAI_API_KEY or
//     engines.openai.api_key in config.
//
// Provider selection in ~/.apx/config.json:
//   "transcription": {
//     "provider": "auto" | "local" | "openai",   // default "auto"
//     "local": {
//       "model": "medium",            // tiny | base | small | medium | large | large-v2 | large-v3
//       "device": "cpu",              // cpu | cuda
//       "compute_type": "int8",       // int8 | int8_float16 | float16 | float32
//       "language": "auto",           // ISO 639-1 code or "auto"
//       "beam_size": 5
//     }
//   }
//
// "auto" tries local first; on failure falls back to openai.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const PYTHON_HELPER = path.join(__dirname, "whisper-transcribe.py");

const DEFAULT_LOCAL = {
  model: "medium",
  device: "cpu",
  compute_type: "int8",
  language: "auto",
  beam_size: 5,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

async function getConfig() {
  try {
    const { readConfig } = await import("../core/config.js");
    const cfg = readConfig() || {};
    const t = cfg.transcription || {};
    const openaiKey = cfg.engines?.openai?.api_key || process.env.OPENAI_API_KEY || "";
    return {
      provider: t.provider || "auto",
      local: { ...DEFAULT_LOCAL, ...(t.local || {}) },
      openaiKey,
    };
  } catch {
    return {
      provider: "auto",
      local: { ...DEFAULT_LOCAL },
      openaiKey: process.env.OPENAI_API_KEY || "",
    };
  }
}

// ---------------------------------------------------------------------------
// Local backend (Python + faster-whisper)
// ---------------------------------------------------------------------------

function transcribeLocal(filePath, opts) {
  return new Promise((resolve, reject) => {
    const args = [
      PYTHON_HELPER,
      filePath,
      "--model",       String(opts.model || DEFAULT_LOCAL.model),
      "--language",    String(opts.language || DEFAULT_LOCAL.language),
      "--device",      String(opts.device || DEFAULT_LOCAL.device),
      "--compute-type", String(opts.compute_type || DEFAULT_LOCAL.compute_type),
      "--beam-size",   String(opts.beam_size || DEFAULT_LOCAL.beam_size),
    ];
    execFile("python3", args, { maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60_000 }, (err, stdout, stderr) => {
      if (err) {
        const tail = (stderr || err.message || "").slice(-300);
        return reject(new Error(`local transcription failed: ${tail}`));
      }
      let parsed;
      try { parsed = JSON.parse(String(stdout).trim().split("\n").pop()); }
      catch (e) {
        return reject(new Error(`could not parse helper output: ${stdout.slice(0, 300)}`));
      }
      if (!parsed.ok) return reject(new Error(parsed.error || "unknown local transcription error"));
      resolve({
        ok: true,
        backend: "local",
        text: parsed.text || "",
        language: parsed.language || null,
        language_probability: parsed.language_probability ?? null,
        duration: parsed.duration ?? null,
        model: parsed.model,
        compute_type: parsed.compute_type,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// OpenAI backend (Whisper-1 cloud)
// ---------------------------------------------------------------------------

async function transcribeOpenAI(filePath, apiKey) {
  if (!apiKey) throw new Error("OPENAI_API_KEY not set (env or engines.openai.api_key)");

  const fileBuf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase() || "ogg";
  const mimeMap = {
    oga: "audio/ogg", ogg: "audio/ogg", opus: "audio/ogg",
    mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4",
    wav: "audio/wav", webm: "audio/webm",
  };
  const blob = new Blob([fileBuf], { type: mimeMap[ext] || "audio/ogg" });

  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Whisper API ${res.status}: ${err.slice(0, 200)}`);
  }
  const json = await res.json();
  return {
    ok: true,
    backend: "openai",
    text: String(json.text || "").trim(),
    language: null,
    language_probability: null,
    duration: null,
    model: "whisper-1",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transcribe an audio file using the configured backend.
 * Returns { ok, backend, text, language?, language_probability?, duration?, model? }.
 *
 * @param {string} filePath   absolute path to audio file
 * @param {object} overrides  optional: { provider, model, language, ... }
 */
export async function transcribe(filePath, overrides = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`transcribe: file not found: ${filePath}`);
  }
  const cfg = await getConfig();
  const provider = overrides.provider || cfg.provider;
  const localOpts = { ...cfg.local, ...overrides };

  if (provider === "openai") {
    return transcribeOpenAI(filePath, cfg.openaiKey);
  }
  if (provider === "local") {
    return transcribeLocal(filePath, localOpts);
  }

  // auto: local first, fall back to openai
  try {
    return await transcribeLocal(filePath, localOpts);
  } catch (localErr) {
    if (!cfg.openaiKey) {
      throw new Error(
        `local transcription failed and no OpenAI fallback available: ${localErr.message}`
      );
    }
    return transcribeOpenAI(filePath, cfg.openaiKey);
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export const TRANSCRIPTION_PATHS = {
  python_helper: PYTHON_HELPER,
};
