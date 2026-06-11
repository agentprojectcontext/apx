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
import { spawn, exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logInfo, logWarn, logError } from "#core/logging.js";

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
  // Max time we wait for /transcribe to return. Long audio files (Telegram
  // voice notes > 10 min) can take several minutes on CPU; the previous
  // hard-coded 5-minute cap silently truncated them. 20 minutes covers a
  // ~60-minute voice note on a small int8 model. Override with
  // transcription.local.timeout_ms in ~/.apx/config.json if needed.
  timeout_ms: 20 * 60_000,
};

// ---------------------------------------------------------------------------
// Config helpers (pure — exported for tests)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective transcription language.
 * Priority: explicit local config → config.user.language → "auto" (whisper detects).
 *
 * @param {object} localCfg   merged transcription.local config
 * @param {string} userLang   config.user.language ISO code (e.g. "es"), or ""
 * @returns {string}          ISO code or "auto"
 */
export function resolveTranscriptionLanguage(localCfg, userLang) {
  if (localCfg.language && localCfg.language !== "auto") return localCfg.language;
  if (userLang) return userLang;
  return "auto";
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

async function getConfig() {
  try {
    const { readConfig } = await import("#core/config/index.js");
    const cfg = readConfig() || {};
    const t = cfg.transcription || {};
    const openaiKey = cfg.engines?.openai?.api_key || process.env.OPENAI_API_KEY || "";
    // Use user.language as default for transcription language if not explicitly set.
    // Explicit transcription.local.language always wins; "auto" means fall back to user.language.
    const userLang = cfg.user?.language || "";
    const localBase = { ...DEFAULT_LOCAL, ...(t.local || {}) };
    localBase.language = resolveTranscriptionLanguage(localBase, userLang);
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

// Check if the running whisper-server is using a specific model.
// Returns the model name string, or null if not reachable.
async function _serverModelName() {
  try {
    const res = await fetch(`http://127.0.0.1:${WHISPER_PORT}/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.model || null;
  } catch {
    return null;
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

// Find the PID of the process LISTENing on the whisper port (server only,
// not clients). Filtering by -sTCP:LISTEN is critical — without it, lsof
// also returns clients with an open connection (including this daemon).
async function _findListenerPid() {
  return new Promise((resolve) => {
    exec(`lsof -ti tcp:${WHISPER_PORT} -sTCP:LISTEN`, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const candidates = stdout.trim().split("\n")
        .map(s => parseInt(s, 10))
        .filter(n => Number.isFinite(n) && n !== process.pid);
      resolve(candidates[0] || null);
    });
  });
}

async function _killOrphanWhisper() {
  // First try graceful /shutdown on the whisper server.
  try {
    await fetch(`http://127.0.0.1:${WHISPER_PORT}/shutdown`, {
      method: "POST", signal: AbortSignal.timeout(1000),
    });
    await _sleep(600);
  } catch {}
  // If still bound, force-kill the LISTENER pid only (never our own pid).
  const pid = await _findListenerPid();
  if (pid && pid !== process.pid) {
    try { process.kill(pid, "SIGTERM"); } catch {}
    await _sleep(400);
    try { process.kill(pid, 0); try { process.kill(pid, "SIGKILL"); } catch {} } catch {}
    await _sleep(300);
  }
}

async function ensureWhisperServer(opts) {
  const model = opts.model || DEFAULT_LOCAL.model;

  // Already running with the right model — health-check to confirm still alive.
  if (_serverProcess && _serverModel === model) {
    if (await _isServerHealthy()) return;
    _serverProcess = null;
    _serverModel = null;
  }

  // Adopt an externally-running whisper-server (e.g. left over from prior daemon).
  if (!_serverProcess) {
    const existing = await _serverModelName();
    if (existing === model) {
      _serverModel = model;
      return;
    }
    if (existing) {
      // Wrong model: kick out the orphan so we can start the right one.
      await _killOrphanWhisper();
    }
  }

  if (_serverProcess) {
    try { _serverProcess.kill(); } catch {}
    _serverProcess = null;
    _serverModel = null;
    await _sleep(300);
  }

  await _spawnWhisper(opts, model, /* retried */ false);
}

async function _spawnWhisper(opts, model, retried) {
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
  try {
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
  } catch (e) {
    // Self-heal: if the port was already in use, kill the orphan and retry once.
    const msg = e.message || "";
    if (!retried && /address already in use|errno 48|eaddrinuse/i.test(msg)) {
      _serverProcess = null;
      _serverModel = null;
      await _killOrphanWhisper();
      return _spawnWhisper(opts, model, /* retried */ true);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Local backend (persistent whisper-server.py via HTTP)
// ---------------------------------------------------------------------------

async function transcribeLocal(filePath, opts) {
  await ensureWhisperServer(opts);

  const language = (opts.language || DEFAULT_LOCAL.language) === "auto"
    ? null
    : (opts.language || null);

  const timeoutMs = Number(opts.timeout_ms) > 0
    ? Number(opts.timeout_ms)
    : DEFAULT_LOCAL.timeout_ms;

  const body = JSON.stringify({
    audio_path: filePath,
    language,
    beam_size: opts.beam_size || DEFAULT_LOCAL.beam_size,
  });

  // Long transcriptions on CPU (small int8, 1-minute voice note) can take
  // 30-45s. Under undici (Node fetch) we occasionally see "fetch failed"
  // from the inbound Telegram path even though the whisper-server completes
  // the request successfully — a keep-alive socket gets reset somewhere
  // between the long whisper-server response and the daemon's other
  // concurrent traffic. We retry once on a generic "fetch failed" so the
  // user actually gets a reply.
  const maxAttempts = 2;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t0 = Date.now();
    try {
      logInfo("whisper", `transcribeLocal attempt ${attempt}/${maxAttempts}`, {
        file: path.basename(filePath),
        language: language || "auto",
        timeout_ms: timeoutMs,
      });
      const res = await fetch(`http://127.0.0.1:${WHISPER_PORT}/transcribe`, {
        method: "POST",
        headers: { "content-type": "application/json", "connection": "close" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "transcription failed");
      logInfo("whisper", `transcribeLocal ok in ${Date.now() - t0}ms`, {
        chars: (json.text || "").length,
        language: json.language,
        duration: json.duration,
      });
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
    } catch (e) {
      lastErr = e;
      const isRetriable =
        /fetch failed|ECONNRESET|socket hang up|terminated/i.test(e.message || "");
      const dt = Date.now() - t0;
      logWarn("whisper", `transcribeLocal attempt ${attempt} failed in ${dt}ms`, {
        error: e.message,
        retriable: isRetriable,
        will_retry: isRetriable && attempt < maxAttempts,
      });
      if (!isRetriable || attempt >= maxAttempts) break;
      // Brief backoff before retry — gives the whisper-server.py thread time
      // to flush its pending response and release the model lock.
      await _sleep(500);
    }
  }
  logError("whisper", `transcribeLocal exhausted retries`, { error: lastErr?.message });
  throw lastErr || new Error("local transcription failed");
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
    // Explicit local-only: bubble up the real error, do not mention OpenAI.
    return transcribeLocal(filePath, localOpts);
  }

  // auto: local first, fall back to openai only if a key is configured
  try {
    return await transcribeLocal(filePath, localOpts);
  } catch (localErr) {
    if (cfg.openaiKey) {
      return transcribeOpenAI(filePath, cfg.openaiKey);
    }
    // No OpenAI configured — surface the real local error verbatim.
    throw new Error(`local transcription failed: ${localErr.message}`);
  }
}

/**
 * Transcribe raw audio bytes (e.g. from a mic chunk or Telegram voice blob).
 * Saves to a temp file, transcribes, cleans up.
 *
 * @param {Buffer} buf        raw audio data
 * @param {string} format     file extension hint: "webm" | "ogg" | "wav" | "mp3" (default "webm")
 * @param {object} overrides  same as transcribe() overrides
 */
export async function transcribeBuffer(buf, format = "webm", overrides = {}) {
  if (!buf || !buf.length) throw new Error("transcribeBuffer: empty buffer");
  const ext = format.replace(/^\./, "") || "webm";
  const tmpFile = path.join(
    (await import("node:os")).default.tmpdir(),
    `apx-audio-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  );
  try {
    fs.writeFileSync(tmpFile, buf);
    return await transcribe(tmpFile, overrides);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Lifecycle (preload on daemon start, shutdown on daemon stop)
// ---------------------------------------------------------------------------

/**
 * Eagerly start the whisper server so the first transcription is fast.
 * Safe to call multiple times. Never throws — logs and continues on failure.
 */
export async function preloadWhisperServer(log = console.log) {
  try {
    const cfg = await getConfig();
    if (cfg.provider === "openai") return; // local backend not used
    log(`whisper: preloading model "${cfg.local.model}" on port ${WHISPER_PORT}…`);
    await ensureWhisperServer(cfg.local);
    log(`whisper: ready on port ${WHISPER_PORT} (model: ${_serverModel})`);
  } catch (e) {
    log(`whisper: preload failed — ${e.message} (will retry lazily on first request)`);
  }
}

/**
 * Keep the local whisper server warm. Ensures it's loaded and pings /health,
 * which resets the server's idle watchdog so a live session (e.g. the desktop
 * window held open) never pays the cold-load cost on the next utterance.
 * Cheap and safe to call repeatedly. Never throws.
 * Returns { ok, model?, loaded?, provider } for the caller to surface.
 */
export async function warmupWhisper() {
  try {
    const cfg = await getConfig();
    if (cfg.provider === "openai") return { ok: true, provider: "openai", loaded: false };
    await ensureWhisperServer(cfg.local);
    // /warmup loads the model into RAM (lazy otherwise) AND touches _last_used,
    // resetting the idle timer. First call may block ~15-30s on a cold model;
    // instant once warm. Generous timeout so the cold load can finish.
    let loaded = false;
    try {
      const r = await fetch(`http://127.0.0.1:${WHISPER_PORT}/warmup`, {
        signal: AbortSignal.timeout(40_000),
      });
      const j = await r.json().catch(() => ({}));
      loaded = !!j.loaded;
    } catch {}
    return { ok: true, provider: "local", model: _serverModel, loaded };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Stop the whisper server we own (no-op if we adopted an external one).
 */
export async function shutdownWhisperServer() {
  if (_serverProcess) {
    try { _serverProcess.kill(); } catch {}
    _serverProcess = null;
    _serverModel = null;
  } else {
    // Try graceful shutdown of an adopted server
    try {
      await fetch(`http://127.0.0.1:${WHISPER_PORT}/shutdown`, {
        method: "POST", signal: AbortSignal.timeout(500),
      });
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export const TRANSCRIPTION_PATHS = {
  whisper_server: WHISPER_SERVER,
  port: WHISPER_PORT,
};
