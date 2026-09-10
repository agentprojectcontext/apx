// OpenAI TTS adapter (tts-1 / tts-1-hd) — and any OpenAI-compatible endpoint.
// Docs: https://platform.openai.com/docs/api-reference/audio/createSpeech
//
// Reuses engines.openai.api_key from ~/.apx/config.json. Per-engine voice
// config (~/.apx/config.json → voice.tts.openai) can override model/voice.
//
// Custom endpoint ("QVox custom"): set voice.tts.openai.base_url to a local
// OpenAI-compatible speech server (e.g. a Qwen3-TTS / QVox daemon at
// http://127.0.0.1:5111/v1). When base_url is set we additionally forward the
// non-OpenAI fields that server understands — `instruct` (the base voice, from
// the `style` arg), `language`, `clone`/`ref_text` and `temperature`. These
// extras are NEVER sent to stock OpenAI (only when base_url is present), so the
// standard path stays byte-for-byte compatible.
//
// Which of `clone` / `voice` / `instruct` is set decides HOW the server speaks,
// and they are not additive — QVox reads them in that order and the first one
// wins. A named speaker carries its own accent, so picking one leaves `style`
// describing only the delivery; only a cloned reference can carry an accent no
// preset speaker has.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_API_URL = "https://api.openai.com/v1/audio/speech";
const STREAM_PROBE_TTL_MS = 60_000;
const _streamProbe = new Map();   // stream url -> { ok, at }
const DEFAULT_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";          // alloy|echo|fable|onyx|nova|shimmer

function getKey(config, parentEnginesCfg) {
  // A custom endpoint uses ONLY its own key (often none); never leak the stock
  // OpenAI engine key / OPENAI_API_KEY env to a third-party server.
  if (config.base_url) return config.api_key || "";
  return (
    config.api_key ||
    parentEnginesCfg?.openai?.api_key ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

function endpoint(config) {
  if (config.base_url) {
    return config.base_url.replace(/\/+$/, "") + "/audio/speech";
  }
  return DEFAULT_API_URL;
}

function mimeFor(format) {
  return {
    mp3: "audio/mpeg",
    opus: "audio/ogg",
    aac: "audio/aac",
    flac: "audio/flac",
    wav: "audio/wav",
    pcm: "audio/L16",
  }[format] || "audio/mpeg";
}

export default {
  id: "openai",

  async isAvailable(config = {}, parentEnginesCfg) {
    // A custom endpoint is assumed reachable (it may be keyless/open like QVox);
    // stock OpenAI needs a key.
    return Boolean(config.base_url) || Boolean(getKey(config, parentEnginesCfg));
  },

  // Only local endpoints have anything to warm. A cloud API is as ready as it
  // will ever be, and a hosted server is not ours to spin up — so a stock
  // OpenAI config skips instead of sending a pointless request.
  async warmup(config = {}) {
    if (!config.base_url) return { ok: true, skipped: "not a local endpoint" };
    const url = config.base_url.replace(/\/+$/, "") + "/warmup";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.api_key ? { authorization: `Bearer ${config.api_key}` } : {}),
      },
      // Say which voice, so the endpoint warms the model that will answer
      // rather than a sibling of it — these are different multi-gigabyte
      // checkpoints, and warming one leaves the other exactly as cold. The
      // clone is named for the same reason: a cloned reference is served by a
      // third checkpoint again, so a warmup that only ever mentions `voice`
      // warms nothing the next request will use.
      body: JSON.stringify({
        ...(config.voice ? { voice: config.voice } : {}),
        ...(config.clone ? { clone: config.clone, ref_text: config.ref_text } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`warmup ${res.status}`);
    return await res.json().catch(() => ({ ok: true }));
  },

  /**
   * Everything a speech request needs, built once.
   *
   * Streaming and non-streaming differ only in which URL they post to and what
   * they do with the answer — the decision of WHO speaks (clone vs named voice
   * vs instruct, language, temperature) has to come out the same either way, or
   * the same text would be read by two different voices depending on the route.
   */
  _request({ text, voice, language, style, config = {}, format, parentEnginesCfg }) {
    if (!text) throw new Error("openai-tts: empty text");
    const isCustom = Boolean(config.base_url);
    const key = getKey(config, parentEnginesCfg);
    if (!isCustom && !key) {
      throw new Error("openai-tts: no api_key (set OPENAI_API_KEY or engines.openai.api_key)");
    }

    const model = config.model || (isCustom ? undefined : DEFAULT_MODEL);
    const chosenVoice = voice || config.voice || (isCustom ? undefined : DEFAULT_VOICE);
    const responseFormat = format || config.format || (isCustom ? "wav" : "mp3");
    const styleHint = String(style ?? config.style ?? "").trim();

    const body = { input: text, response_format: responseFormat };
    if (model) body.model = model;
    if (chosenVoice) body.voice = chosenVoice;
    if (isCustom) {
      // QVox / Qwen3-TTS extras (ignored by stock OpenAI, so only sent here).
      if (styleHint) body.instruct = styleHint;
      // A caller that names a language wins; otherwise the configured one.
      // Nothing in the speaking path (Telegram voice notes, the desktop, a
      // routine) passes one, so without this the server was left to guess from
      // its own default — right by luck here, wrong for anyone whose local
      // server defaults elsewhere.
      const lang = language || config.language;
      if (lang && lang !== "auto") body.language = lang;
      // Voice cloning: the endpoint reads the reference itself, so this is a
      // path on ITS filesystem, not ours. `ref_text` is what the recording
      // says — optional, and worth setting: telling the model that measured
      // 15.8 chars/s against 12.9 without it.
      if (config.clone) body.clone = config.clone;
      if (config.ref_text) body.ref_text = config.ref_text;
      if (config.temperature != null) body.temperature = config.temperature;
    } else if (styleHint && /gpt-4o.*tts/i.test(model || "")) {
      // Stock OpenAI's newer TTS models accept a natural-language `instructions`.
      body.instructions = styleHint;
    }

    const headers = { "content-type": "application/json" };
    if (key) {
      headers.authorization = `Bearer ${key}`;
      if (isCustom) headers["x-api-key"] = key; // QVox accepts either header.
    }
    return { isCustom, headers, body, responseFormat };
  },

  async synthesize({ text, voice, language, style, outDir, config = {}, format, signal, parentEnginesCfg }) {
    const { headers, body, responseFormat } =
      this._request({ text, voice, language, style, config, format, parentEnginesCfg });

    const res = await fetch(endpoint(config), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`openai-tts ${res.status}: ${err.slice(0, 300)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());

    fs.mkdirSync(outDir, { recursive: true });
    const audioPath = path.join(outDir, `openai-${randomUUID()}.${responseFormat}`);
    fs.writeFileSync(audioPath, buf);

    return {
      audio_path: audioPath,
      duration_s: null,
      mime: mimeFor(responseFormat),
      provider: "openai",
    };
  },

  /**
   * Whether this engine can hand back audio while it is still being made.
   *
   * Only a self-hosted endpoint can: stock OpenAI has no such route, and among
   * the local ones it is QVox that grew one. Declared rather than attempted,
   * so a caller can fall back to synthesize() instead of failing a reply.
   */
  canStream(config = {}) {
    return Boolean(config.base_url) && config.stream !== false;
  },

  /**
   * Whether the endpoint really has the streaming route, asked rather than
   * assumed.
   *
   * canStream() only says this adapter would attempt it — enough to choose a
   * path, wrong to show a badge with. Two self-hosted servers on this machine
   * answer differently: QVox replies 400 to an empty body because the route is
   * there and the body is not, Pocket replies 404 because the route is not.
   * Anything but 404/405 means something is listening at that path.
   *
   * Cached per endpoint: a settings page lists every engine at once, and the
   * answer is a property of the server, not of the moment.
   */
  async probeStream(config = {}) {
    if (!this.canStream(config)) return false;
    const url = endpoint(config).replace(/\/audio\/speech$/, "/audio/speech/stream");
    const hit = _streamProbe.get(url);
    if (hit && Date.now() - hit.at < STREAM_PROBE_TTL_MS) return hit.ok;
    let ok = false;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(4000),
      });
      ok = res.status !== 404 && res.status !== 405;
      // Nothing is read: the empty body guarantees a refusal, and the point is
      // the status line.
      res.body?.cancel?.();
    } catch {
      ok = false;   // unreachable is not the same as "cannot stream", but for a
                    // badge it reads the same and costs nothing to be wrong about
    }
    _streamProbe.set(url, { ok, at: Date.now() });
    return ok;
  },

  /**
   * Yield raw PCM as the server produces it, via QVox's /audio/speech/stream.
   *
   * The wait for a spoken reply is not the audio, it is waiting for all of it:
   * the same line takes ~3.5 s to come back as a finished WAV and puts its
   * first chunk on the wire at ~0.3 s here. Nothing is written to disk — the
   * point is that the caller can start playing before there is a file to write.
   *
   * onChunk(pcmBuffer, sampleRate) is called per chunk; the returned totals are
   * for logging. 16-bit little-endian mono, rate from X-QVox-Sample-Rate.
   */
  async synthesizeStream({ text, voice, language, style, config = {}, signal, parentEnginesCfg, interval }, onChunk) {
    const { isCustom, headers, body } =
      this._request({ text, voice, language, style, config, format: "wav", parentEnginesCfg });
    if (!isCustom) throw new Error("openai-tts: streaming needs a self-hosted base_url");

    // response_format means nothing to a raw PCM stream, and `interval` is how
    // much audio the server should gather before flushing each chunk.
    delete body.response_format;
    if (interval != null) body.interval = interval;

    const url = endpoint(config).replace(/\/audio\/speech$/, "/audio/speech/stream");
    const t0 = Date.now();
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`openai-tts stream ${res.status}: ${err.slice(0, 300)}`);
    }

    const sampleRate = Number(res.headers.get("x-qvox-sample-rate") || 24000);
    const reader = res.body.getReader();
    let firstMs = null;
    let bytes = 0;
    // A network read can end mid-sample; half a sample handed to a player is a
    // click, so the odd byte waits for the rest of itself.
    let odd = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstMs === null) firstMs = Date.now() - t0;
      let buf = Buffer.from(value);
      if (odd) { buf = Buffer.concat([odd, buf]); odd = null; }
      if (buf.length % 2) { odd = buf.subarray(buf.length - 1); buf = buf.subarray(0, buf.length - 1); }
      if (!buf.length) continue;
      bytes += buf.length;
      onChunk(buf, sampleRate);
    }
    return {
      sample_rate: sampleRate,
      first_chunk_ms: firstMs,
      duration_s: bytes / 2 / sampleRate,
      total_ms: Date.now() - t0,
      provider: "openai",
    };
  },
};
