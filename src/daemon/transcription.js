// daemon/transcription.js
// Audio transcription dispatcher. Two backends:
//
//   - LOCAL (faster-whisper via persistent Python server) — the server loads
//     the model once on first use and keeps it in RAM. It auto-shuts down after
//     idle_minutes (default 10) of inactivity, then restarts lazily on the
//     next request. Requires `pip3 install faster-whisper` on the host.
//
//   - OPENAI (Whisper-1 cloud API) — needs OPENAI_API_KEY or
//     engines.openai.api_key in config.
//
// Provider selection in ~/.apx/config.json:
//   "transcription": {
//     "provider": "auto" | "local" | "openai",   // default "auto"
//     "local": {
//       "model": "small",           // tiny | base | small | medium | large | large-v2 | large-v3
//       "device": "cpu",            // cpu | cuda
//       "compute_type": "int8",     // int8 | int8_float16 | float16 | float32
//       "language": "auto",         // ISO 639-1 code (e.g. "es") or "auto"
//       "beam_size": 5,
//       "idle_minutes": 10          // auto-shutdown after N minutes idle
//     }
//   }
//
// "auto" tries local first; on failure falls back to openai.
//
// Spanish tip: set language: "es" for better accuracy with the small model.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WHISPER_SERVER = path.join(__dirname, "whisper-server.py");
const WHISPER_PORT = 18765;

const DEFAULT_LOCAL = {
  model: "small",
  device: "cpu",
  compute_type: "int8",
  language: "auto",
  beam_size: 5,
  idle_minutes: 10,
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
    // Use user.language as default for transcription language if not explicitly set.
    // Explicit transcription.local.language always wins; "auto" means fall back to user.language.
    const userLang = cfg.user?.language || "";
    const localBase = { ...DEFAULT_LOCAL, ...(t.local || {}) };
    if ((!localBase.language || localBase.language === "auto") && userLang) {
      localBase.language = userLang;
    }
    return {
      provider: t.provider || "auto",
      local: localBase,
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
// Persistent server management
// ---------------------------------------------------------------------------

let _serverProcess = null;
let _serverModel = null;   // model the running server was started with

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function _isServerHealthy() {
  try {
    const res = await fetch(`http://127.0.0.1:${WHISPER_PORT}/health`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function _waitForServer(maxMs = 15_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await _isServerHealthy()) return;
    await _sleep(250);
  }
  throw new Error(`whisper-server did not start within ${maxMs}ms`);
}

async function ensureWhisperServer(opts) {
  const model = opts.model || DEFAULT_LOCAL.model;

  // Already running with the right model — health-check to confirm still alive.
  if (_serverProcess && _serverModel === model) {
    if (await _isServerHealthy()) return;
    // Process died (idle shutdown). Fall through to restart.
    _serverProcess = null;
    _serverModel = null;
  }

  // Wrong model: kill old server and start fresh.
  if (_serverProcess) {
    try { _serverProcess.kill(); } catch {}
    _serverProcess = null;
    _serverModel = null;
    await _sleep(300);
  }

  const args = [
    WHISPER_SERVER,
    "--port", String(WHISPER_PORT),
    "--model", model,
    "--device", String(opts.device || DEFAULT_LOCAL.device),
    "--compute-type", String(opts.compute_type || DEFAULT_LOCAL.compute_type),
    "--idle-minutes", String(opts.idle_minutes ?? DEFAULT_LOCAL.idle_minutes),
  ];

  const proc = spawn("python3", args, {
    stdio: ["ignore", "pipe", "inherit"],
    detached: false,
  });

  _serverProcess = proc;
  _serverModel = model;

  proc.on("exit", () => {
    if (_serverProcess === proc) {
      _serverProcess = null;
      _serverModel = null;
    }
  });

  // Wait for the "ready" line on stdout, then wait for HTTP to respond.
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("whisper-server startup timed out (15s)")),
      15_000
    );
    let buf = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      clearTimeout(timeout);
      try {
        const msg = JSON.parse(line);
        if (msg.status === "error") return reject(new Error(msg.error || "whisper-server error"));
        resolve(); // "ready"
      } catch {
        resolve(); // unexpected line but server is up
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`whisper-server exited (code ${code}) before becoming ready`));
    });
  });
}

// ---------------------------------------------------------------------------
// Local backend (persistent whisper-server.py via HTTP)
// ---------------------------------------------------------------------------

async function transcribeLocal(filePath, opts) {
  await ensureWhisperServer(opts);

  const language = (opts.language || DEFAULT_LOCAL.language) === "auto"
    ? null
    : (opts.language || null);

  const res = await fetch(`http://127.0.0.1:${WHISPER_PORT}/transcribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audio_path: filePath,
      language,
      beam_size: opts.beam_size || DEFAULT_LOCAL.beam_size,
    }),
    signal: AbortSignal.timeout(5 * 60_000),
  });

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "transcription failed");

  return {
    ok: true,
    backend: "local",
    text: json.text || "",
    language: json.language || null,
    language_probability: json.language_probability ?? null,
    duration: json.duration ?? null,
    model: json.model,
    compute_type: json.compute_type,
  };
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
 * @param {object} overrides  optional: { provider, model, language, idle_minutes, ... }
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
  whisper_server: WHISPER_SERVER,
  port: WHISPER_PORT,
};
