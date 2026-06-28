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
  // "auto" = adapt to the machine (mlx/Metal on Apple Silicon, faster-whisper
  // cuda on NVIDIA, else faster-whisper cpu). Override with "faster" | "mlx".
  backend: "auto",
  model: "small",          // faster-whisper model id (tiny|base|small|…)
  mlx_model: "",           // mlx repo (defaults to the hardware recommendation)
  device: "cpu",
  compute_type: "int8",
  language: "auto",
  beam_size: 5,
  idle_minutes: 10,
  // Long audio (Telegram voice notes > 10 min) can take several minutes on
  // CPU. 20 minutes covers ~60-minute notes on a small int8 model.
  timeout_ms: 20 * 60_000,
};

// OpenAI's official cloud Whisper. `base_url` is overridable so the same
// client can target any OpenAI-compatible server (see `custom`).
export const DEFAULT_OPENAI = {
  base_url: "https://api.openai.com/v1",
  model: "whisper-1",
  language: "auto",
};

// A user-supplied, OpenAI-compatible STT server reachable over the network:
// mlx-audio on this Mac's Metal GPU (localhost:8000), a Radeon/NVIDIA box on
// the LAN, or anyone's remote endpoint. All expose POST /audio/transcriptions,
// so they share the exact client as `openai` — only base_url/key/model differ.
export const DEFAULT_CUSTOM = {
  base_url: "",   // e.g. http://localhost:8000/v1  or  http://192.168.1.50:9000/v1
  api_key: "",    // optional — most local servers don't require one
  model: "",      // e.g. mlx-community/whisper-large-v3-turbo  or  Systran/faster-whisper-large-v3
  language: "auto",
};

/** STT engine ids surfaced to the web admin, in display/fallback order. */
export const STT_ENGINE_IDS = ["local", "openai", "custom"];

/**
 * Resolve the effective transcription language. Priority:
 *   explicit local config → config.user.language → "auto" (whisper detects).
 */
export function resolveTranscriptionLanguage(localCfg, userLang) {
  if (localCfg.language && localCfg.language !== "auto") return localCfg.language;
  if (userLang) return userLang;
  return "auto";
}

/**
 * Resolve the local engine's effective backend + model in place.
 *   backend "auto" → mlx (Apple Silicon/Metal), faster-whisper cuda (NVIDIA),
 *   else faster-whisper cpu.
 * Safety net: if the chosen mlx model isn't downloaded yet, fall back to
 * faster-whisper so a live voice turn never stalls on a multi-GB download —
 * the model-manager UI handles the explicit download.
 */
async function resolveLocalBackend(local) {
  let backend = local.backend || "auto";
  let rec;
  try {
    const { recommendStt } = await import("#core/voice/stt-hardware.js");
    rec = recommendStt();
  } catch {
    rec = { backend: "faster", model: "small", device: "cpu", compute_type: "int8" };
  }
  if (backend === "auto") backend = rec.backend;

  if (backend === "mlx") {
    const mlxModel = local.mlx_model || rec.model;
    let downloaded = false;
    try {
      const { modelStatusByRepo } = await import("#core/voice/stt-models.js");
      downloaded = modelStatusByRepo(mlxModel).downloaded;
    } catch {}
    if (downloaded) {
      local.backend = "mlx";
      local.model = mlxModel;       // whisper-server.js passes this as --model
      local.device = "metal";
      local.compute_type = "mlx";
      return;
    }
    backend = "faster";             // not present → don't block voice
  }

  // faster-whisper path. On an NVIDIA box, prefer CUDA + float16 unless the
  // user pinned something explicit.
  if (rec.backend === "faster" && rec.device === "cuda") {
    if (!local.device || local.device === "cpu") local.device = "cuda";
    if (local.compute_type === "int8") local.compute_type = rec.compute_type || "float16";
  }
  local.backend = "faster";
}

export async function getConfig() {
  try {
    const { readConfig } = await import("#core/config/index.js");
    const cfg = readConfig() || {};
    const t = cfg.transcription || {};
    const userLang = cfg.user?.language || "";

    const localBase = { ...DEFAULT_LOCAL, ...(t.local || {}) };
    localBase.language = resolveTranscriptionLanguage(localBase, userLang);
    await resolveLocalBackend(localBase);

    // OpenAI cloud: key can live in transcription.openai, the shared
    // engines.openai block, or the env. base_url defaults to the official API.
    const openai = { ...DEFAULT_OPENAI, ...(t.openai || {}) };
    openai.api_key = t.openai?.api_key || cfg.engines?.openai?.api_key || process.env.OPENAI_API_KEY || "";
    openai.language = resolveTranscriptionLanguage(openai, userLang);

    // Custom OpenAI-compatible server (mlx-audio / Radeon / NVIDIA / remote).
    const custom = { ...DEFAULT_CUSTOM, ...(t.custom || {}) };
    custom.language = resolveTranscriptionLanguage(custom, userLang);

    return {
      provider: t.provider || "auto",
      local: localBase,
      openai,
      custom,
      // kept for backward-compat with callers that read `.openaiKey`
      openaiKey: openai.api_key,
    };
  } catch {
    return {
      provider: "auto",
      local: { ...DEFAULT_LOCAL },
      openai: { ...DEFAULT_OPENAI, api_key: process.env.OPENAI_API_KEY || "" },
      custom: { ...DEFAULT_CUSTOM },
      openaiKey: process.env.OPENAI_API_KEY || "",
    };
  }
}

/**
 * List STT engines + availability for the web admin (mirrors tts listProviders).
 * @returns {{configured_provider:string, engines:Array<{id,available,configured}>}}
 */
export function listSttProviders(rawConfig = {}) {
  const t = rawConfig.transcription || {};
  const provider = t.provider || "auto";
  const openaiKey = t.openai?.api_key || rawConfig.engines?.openai?.api_key || process.env.OPENAI_API_KEY || "";
  const customUrl = (t.custom?.base_url || "").trim();
  const engines = [
    // local whisper is embedded (daemon spawns the subprocess on demand) →
    // always usable, no credentials needed.
    { id: "local",  available: true,            configured: true },
    { id: "openai", available: Boolean(openaiKey), configured: Boolean(openaiKey) },
    { id: "custom", available: Boolean(customUrl), configured: Boolean(customUrl) },
  ];
  return { configured_provider: provider, engines };
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

/**
 * OpenAI-compatible transcription (POST {base_url}/audio/transcriptions with a
 * multipart `file` + `model`). Works against OpenAI itself and any server that
 * speaks the same contract: mlx-audio, faster-whisper-server, whisper.cpp
 * server, etc. `backend` is just the label returned to the caller.
 */
export async function transcribeViaOpenAICompatible(filePath, { base_url, api_key, model, language, backend = "openai", timeout_ms = 120_000 } = {}) {
  const baseUrl = (base_url || DEFAULT_OPENAI.base_url).replace(/\/+$/, "");
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase() || "webm";
  const fileType = ext === "ogg" || ext === "oga" ? "audio/ogg"
    : ext === "mp3" ? "audio/mpeg"
    : ext === "m4a" ? "audio/mp4"
    : ext === "wav" ? "audio/wav"
    : ext === "webm" ? "audio/webm"
    : "application/octet-stream";

  const form = new FormData();
  form.append("model", model || DEFAULT_OPENAI.model);
  if (language && language !== "auto") form.append("language", language);
  form.append("file", new Blob([buf], { type: fileType }), path.basename(filePath));

  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    // Auth header only when a key is set — local servers usually need none.
    headers: api_key ? { authorization: `Bearer ${api_key}` } : {},
    body: form,
    signal: AbortSignal.timeout(timeout_ms),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`${backend} stt ${res.status}: ${errBody.slice(0, 240)}`);
  }
  const json = await res.json();
  logInfo("whisper", `transcribeViaOpenAICompatible(${backend}) ok in ${Date.now() - t0}ms`, {
    chars: (json.text || "").length, base_url: baseUrl, model: model || DEFAULT_OPENAI.model,
  });
  return {
    ok: true,
    backend,
    text: json.text || "",
    language: json.language || null,
  };
}

/** Back-compat shim: OpenAI Whisper-1 cloud API by key. */
export async function transcribeOpenAI(filePath, apiKey) {
  if (!apiKey) throw new Error("openai transcription: no api_key");
  return transcribeViaOpenAICompatible(filePath, { ...DEFAULT_OPENAI, api_key: apiKey, backend: "openai" });
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
    return transcribeViaOpenAICompatible(filePath, { ...cfg.openai, backend: "openai" });
  }
  if (provider === "custom") {
    if (!cfg.custom.base_url) throw new Error("custom transcription: set transcription.custom.base_url");
    return transcribeViaOpenAICompatible(filePath, { ...cfg.custom, backend: "custom" });
  }
  if (provider === "local") {
    return transcribeViaLocalServer(filePath, localOpts);
  }
  // auto: local first, then a configured remote (custom preferred over openai).
  try {
    return await transcribeViaLocalServer(filePath, localOpts);
  } catch (localErr) {
    if (cfg.custom.base_url) {
      return transcribeViaOpenAICompatible(filePath, { ...cfg.custom, backend: "custom" });
    }
    if (cfg.openai.api_key) {
      return transcribeViaOpenAICompatible(filePath, { ...cfg.openai, backend: "openai" });
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
