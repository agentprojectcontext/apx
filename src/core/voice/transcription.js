// Audio transcription client. Two backends, both pure (no subprocess lifecycle):
//
//   - LOCAL: HTTP client that talks to the persistent whisper-server.py at
//     localhost:WHISPER_LOCAL_PORT. The server itself is spun up/down by
//     host/daemon/whisper-server.js — this file just assumes it is reachable.
//   - OPENAI: Whisper-1 cloud API. Needs OPENAI_API_KEY or
//     engines.openai.api_key in config.
//
// Provider selection in ~/.apx/config.json:
//   "transcription": {
//     "provider": "auto" | "local" | "openai",
//     "local": { model, device, compute_type, language, beam_size, idle_minutes }
//   }
// "auto" tries local first, falls back to OpenAI if a key is configured.
//
// The split rule: anything that boots/teardown a process lives in host/daemon.
// Anything that sends bytes over HTTP and parses JSON lives here.
import fs from "node:fs";
import path from "node:path";
import { logInfo, logWarn } from "#core/logging.js";

/** Port the host-side whisper-server.py listens on. Single source of truth. */
export const WHISPER_LOCAL_PORT = 18765;

export const DEFAULT_LOCAL = {
  model: "small",
  device: "cpu",
  compute_type: "int8",
  language: "auto",
  beam_size: 5,
  idle_minutes: 10,
  // Long audio (Telegram voice notes > 10 min) can take several minutes on
  // CPU. 20 minutes covers ~60-minute notes on a small int8 model.
  timeout_ms: 20 * 60_000,
};

/**
 * Resolve the effective transcription language. Priority:
 *   explicit local config → config.user.language → "auto" (whisper detects).
 */
export function resolveTranscriptionLanguage(localCfg, userLang) {
  if (localCfg.language && localCfg.language !== "auto") return localCfg.language;
  if (userLang) return userLang;
  return "auto";
}

export async function getConfig() {
  try {
    const { readConfig } = await import("#core/config/index.js");
    const cfg = readConfig() || {};
    const t = cfg.transcription || {};
    const openaiKey = cfg.engines?.openai?.api_key || process.env.OPENAI_API_KEY || "";
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

/**
 * Call the local whisper-server.py over HTTP. Does NOT spawn or check the
 * subprocess — that's host/daemon/whisper-server.js's job. If the server is
 * down, this throws a clear "ECONNREFUSED" the caller can surface.
 */
export async function transcribeViaLocalServer(filePath, opts) {
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

  // Long transcriptions on CPU sometimes trip undici keep-alive on the
  // outbound socket — retry once on generic "fetch failed".
  const maxAttempts = 2;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t0 = Date.now();
    try {
      logInfo("whisper", `transcribeViaLocalServer attempt ${attempt}/${maxAttempts}`, {
        file: path.basename(filePath),
        language: language || "auto",
        timeout_ms: timeoutMs,
      });
      const res = await fetch(`http://127.0.0.1:${WHISPER_LOCAL_PORT}/transcribe`, {
        method: "POST",
        headers: { "content-type": "application/json", "connection": "close" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "transcription failed");
      logInfo("whisper", `transcribeViaLocalServer ok in ${Date.now() - t0}ms`, {
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
      const isRetriable = /fetch failed|ECONNRESET|socket hang up|terminated/i.test(e.message || "");
      const dt = Date.now() - t0;
      logWarn("whisper", `transcribeViaLocalServer attempt ${attempt} failed in ${dt}ms`, {
        error: e.message,
        retriable: isRetriable,
        will_retry: isRetriable && attempt < maxAttempts,
      });
      if (!isRetriable || attempt >= maxAttempts) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr || new Error("transcribeViaLocalServer: unknown failure");
}

/** OpenAI Whisper-1 cloud API. Needs an api_key. */
export async function transcribeOpenAI(filePath, apiKey) {
  if (!apiKey) throw new Error("openai transcription: no api_key");
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase() || "webm";
  const fileType = ext === "ogg" || ext === "oga" ? "audio/ogg"
    : ext === "mp3" ? "audio/mpeg"
    : ext === "m4a" ? "audio/mp4"
    : ext === "wav" ? "audio/wav"
    : ext === "webm" ? "audio/webm"
    : "application/octet-stream";

  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("file", new Blob([buf], { type: fileType }), path.basename(filePath));

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`openai whisper ${res.status}: ${errBody.slice(0, 240)}`);
  }
  const json = await res.json();
  return {
    ok: true,
    backend: "openai",
    text: json.text || "",
    language: json.language || null,
  };
}

/**
 * Transcribe a file. Provider chosen by config:
 *   - "openai": cloud only
 *   - "local":  whisper-server only (no fallback)
 *   - "auto":   local first, OpenAI fallback if api_key present
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
    return transcribeViaLocalServer(filePath, localOpts);
  }
  // auto: local first, fall back to openai if a key is configured
  try {
    return await transcribeViaLocalServer(filePath, localOpts);
  } catch (localErr) {
    if (cfg.openaiKey) {
      return transcribeOpenAI(filePath, cfg.openaiKey);
    }
    throw new Error(`local transcription failed: ${localErr.message}`);
  }
}

/**
 * Transcribe raw audio bytes. Saves to a temp file, transcribes, cleans up.
 * @param {Buffer} buf
 * @param {string} format  extension hint ("webm" | "ogg" | "wav" | "mp3")
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
