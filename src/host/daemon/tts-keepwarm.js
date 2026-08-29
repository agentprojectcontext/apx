// Keeps a self-hosted voice engine's weights resident, the same way
// whisper-server.js does for transcription.
//
// The problem is not loading — the engine reports `load 0.0s` throughout. On a
// machine short on RAM macOS compresses the model's pages out from under a
// process that is merely idle, and the next generation pays to decompress
// several gigabytes before it can emit a single token. Measured on this M4 Pro
// with Qwen3-TTS: 1.5s after two minutes idle, 24.5s after nine.
//
// The desktop already asks for a warm-up when the microphone opens, which is
// the right idea and not enough on its own: an utterance lasts three seconds
// and the decompression takes twenty, so the reply's own synthesis queues
// behind a warm-up that is still running. Paying it on a timer instead means
// it is never on the path of a turn at all.
//
// Only ever pointed at an engine the user runs themselves — see isSelfHosted.
// A periodic ping at a metered cloud endpoint would quietly bill for silence.
import { warmupTts } from "#core/voice/tts.js";
import { resolveTtsCandidates } from "#core/voice/engines/index.js";
import { readConfig } from "#core/config/index.js";

// Nine minutes was cold and two and a half was fine, so the default sits well
// inside the window rather than close to its edge — the ping is cheap and a
// missed one costs twenty seconds.
export const DEFAULT_KEEP_WARM_MINUTES = 3;

let _timer = null;

/**
 * Whether an engine runs on this machine or the local network, and so costs
 * nothing to poke. Anything reached over the public internet is somebody's
 * metered API, whatever it is nominally called.
 */
export function isSelfHosted(baseUrl) {
  let host;
  try { host = new URL(String(baseUrl)).hostname.toLowerCase(); } catch { return false; }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;   // 172.16/12
  return false;
}

/**
 * The engine a keep-warm ping would reach, or null when pinging it would be
 * wrong: nothing configured, no warm-up support, or a remote/metered endpoint.
 */
export async function keepWarmTarget(globalConfig) {
  const cfg = globalConfig || readConfig() || {};
  const [first] = await resolveTtsCandidates({ globalConfig: cfg });
  if (!first) return null;
  if (typeof first.adapter?.warmup !== "function") return null;
  if (!isSelfHosted(first.engineConfig?.base_url)) return null;
  return first;
}

export async function startTtsKeepWarm(log = console.log) {
  stopTtsKeepWarm();
  try {
    const cfg = readConfig() || {};
    const ttsCfg = cfg?.voice?.tts || {};
    if (ttsCfg.keep_warm === false) return;
    const target = await keepWarmTarget(cfg);
    if (!target) return;

    const minutes = Number(ttsCfg.keep_warm_minutes ?? DEFAULT_KEEP_WARM_MINUTES) || DEFAULT_KEEP_WARM_MINUTES;
    const everyMs = Math.max(60_000, minutes * 60_000);
    const ping = () => {
      warmupTts({ globalConfig: readConfig() || {} })
        .then((r) => { if (!r.ok) log(`tts: keep-warm failed — ${r.error}`); })
        .catch(() => {});
    };
    ping();
    _timer = setInterval(ping, everyMs);
    _timer.unref?.();
    log(`tts: keep-warm every ${Math.round(everyMs / 60_000)} min (${target.provider})`);
  } catch (e) {
    log(`tts: keep-warm not started — ${e?.message || e}`);
  }
}

export function stopTtsKeepWarm() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}
