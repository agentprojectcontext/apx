// APX's own voice and voice calls from the panel (services/native-voice.ts, engine/calls.ts,
// services/voice-engine.ts, transport/voice-call.ts).
import type { CallStatus, VoiceStatus } from "@apx/protocol";
import type { createCallServices } from "../engine/call-services.ts";
import type { Calls } from "../engine/calls.ts";
import { defaultWakeWords, wakeMatch } from "../engine/wake.ts";
import { errorMessage, unavailable } from "../errors.ts";
import type { NativeVoiceSettings } from "../services/native-voice.ts";
import type { VoiceEngine } from "../services/voice-engine.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

const NEEDS = {
  platform: "calls need a Mac with Apple silicon",
  memory: "this computer does not have enough memory for calls",
  uv: "calls need uv (brew install uv)",
  off: "APX's voice is turned off",
  model: "calls need a model APX can call directly",
  disabled: "calls are turned off in Settings › Voice and calls",
  speech: "choose a speech service in Settings › Voice and calls",
  transcription: "choose a transcription service in Settings › Voice and calls",
} as const;

const NONE: VoiceStatus = {
  tier: "none",
  memory_gb: 0,
  missing: "platform",
  enabled: false,
  installed: false,
  hears_installed: false,
  running: false,
  voice: { gender: "female", locale: "es-AR" },
  calls: false,
  quality: "auto",
  can_full: false,
  wake_words: [],
};

export type VoiceDeps = {
  calls: Calls;
  engine: VoiceEngine;
  native: NativeVoiceSettings;
  remote?: VoiceEngine;
  callEngine?: () => VoiceEngine;
  callServices?: () => Omit<Parameters<typeof createCallServices>[0], "send" | "failed"> | undefined;
  hasService?: (kind: "speech" | "transcription", id: string | undefined) => boolean;
  /** Words in a short clip, from a transcription engine on this machine (undefined: none here). */
  listen?: (bytes: Buffer, mime: string, signal: AbortSignal) => Promise<string | undefined>;
  /** The super-agent's name, what wakes it by default. */
  bossName?: () => string;
};

export function callHandlers(d: VoiceDeps | undefined) {
  /** The owner's phrases, or a call word and the super-agent's name. */
  const wakeWords = () => {
    const set = d?.native.wakeWords() ?? [];
    return set.length ? set : defaultWakeWords(d?.bossName?.() ?? "");
  };
  const withWake = (s: VoiceStatus): VoiceStatus => ({ ...s, wake_words: wakeWords() });
  function callStatus(): CallStatus {
    if (!d) return { ready: false, running: false, missing: "platform" };
    const v = d.native.status();
    const remote = v.call_engine === "services";
    const audioMissing = remote
      ? !d.hasService?.("speech", v.call_speech)
        ? "speech"
        : !d.hasService?.("transcription", v.call_transcription)
          ? "transcription"
          : !d.remote || d.remote.machine().missing
            ? "uv"
            : undefined
      : (v.missing ?? (!v.enabled ? "off" : undefined));
    const missing: CallStatus["missing"] = !v.calls
      ? "disabled"
      : (audioMissing ?? (!d.calls.hasModel() ? "model" : undefined));
    const { live, device, mode } = d.calls.status();
    return {
      // Not downloaded yet is not missing: the first call waits for it.
      ready: !missing,
      engine: remote ? "services" : "native",
      running: remote ? Boolean(d.remote?.running()) : v.running,
      ...(missing ? { missing } : {}),
      ...(live ? { live, ...(device ? { live_device: device } : {}), ...(mode ? { live_mode: mode } : {}) } : {}),
      voice: v.voice,
    };
  }

  return {
    "voice.status": () => withWake(d?.native.status() ?? NONE),
    "voice.install": async (p) => {
      if (!d) throw unavailable(NEEDS.platform);
      return d.native.install(p.part);
    },
    "voice.set": (p) => {
      if (!d) throw unavailable(NEEDS.platform);
      return withWake(d.native.set(p));
    },
    "voice.wake": async ({ data, mime }) => {
      const none = "waking by voice needs a transcription engine on this computer";
      if (!d?.listen) throw unavailable(none);
      let text: string | undefined;
      try {
        text = await d.listen(Buffer.from(data, "base64"), mime, AbortSignal.timeout(25_000));
      } catch (err) {
        throw unavailable(errorMessage(err, 200));
      }
      if (text === undefined) throw unavailable(none);
      return { awake: Boolean(wakeMatch(text, wakeWords())), text };
    },
    "calls.status": callStatus,
    "calls.start": (p, ctx?: Pick<CallContext, "device">) => {
      const s = callStatus();
      if (!d || s.missing) throw unavailable(NEEDS[s.missing ?? "platform"]);
      if (d.native.status().call_engine !== "services" && !d.engine.installed()) d.native.install();
      const v = d.native.voice();
      return d.calls.start({
        agent_id: p.agent_id,
        voice: p.voice ?? v.gender,
        locale: p.locale ?? v.locale,
        thread: p.thread,
        mode: p.mode,
        device: ctx?.device?.name,
      });
    },
    "calls.prepare": () => {
      // Only where a call could start now: never downloads, never wakes a voice that is off.
      if (d && !callStatus().missing) {
        const engine = d.native.status().call_engine === "services" ? d.remote : d.engine;
        if (engine?.installed()) engine.prepare();
      }
      return { ok: true as const };
    },
    "calls.say": ({ thread_id, text }) => {
      if (!d?.calls.typed(thread_id, text)) throw unavailable("this call is not going on");
      return { ok: true as const };
    },
    "calls.end": ({ thread_id }) => {
      d?.calls.end(thread_id);
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}
