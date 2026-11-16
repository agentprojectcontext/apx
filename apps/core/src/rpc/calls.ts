// APX's own voice and voice calls from the panel (services/native-voice.ts, engine/calls.ts,
// services/voice-engine.ts, transport/voice-call.ts).
import type { CallStatus, VoiceStatus } from "@apx/protocol";
import type { Calls } from "../engine/calls.ts";
import { unavailable } from "../errors.ts";
import type { NativeVoiceSettings } from "../services/native-voice.ts";
import type { VoiceEngine } from "../services/voice-engine.ts";
import type { Handlers } from "./router.ts";

const NEEDS = {
  platform: "calls need a Mac with Apple silicon",
  memory: "this computer does not have enough memory for calls",
  uv: "calls need uv (brew install uv)",
  off: "APX's voice is turned off",
  model: "calls need a model APX can call directly",
  disabled: "calls are turned off in Settings › Voice and calls",
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
};

export type VoiceDeps = { calls: Calls; engine: VoiceEngine; native: NativeVoiceSettings };

export function callHandlers(d: VoiceDeps | undefined) {
  function callStatus(): CallStatus {
    if (!d) return { ready: false, running: false, missing: "platform" };
    const v = d.native.status();
    const missing: CallStatus["missing"] =
      v.missing ?? (!v.calls ? "disabled" : !v.enabled ? "off" : !d.calls.hasModel() ? "model" : undefined);
    const live = d.calls.status().live;
    return {
      // Not downloaded yet is not missing: the first call waits for it.
      ready: !missing,
      running: v.running,
      ...(missing ? { missing } : {}),
      ...(live ? { live } : {}),
      voice: v.voice,
    };
  }

  return {
    "voice.status": () => d?.native.status() ?? NONE,
    "voice.install": async (p) => {
      if (!d) throw unavailable(NEEDS.platform);
      return d.native.install(p.part);
    },
    "voice.set": (p) => {
      if (!d) throw unavailable(NEEDS.platform);
      return d.native.set(p);
    },
    "calls.status": callStatus,
    "calls.start": (p) => {
      const s = callStatus();
      if (!d || s.missing) throw unavailable(NEEDS[s.missing ?? "platform"]);
      if (!d.engine.installed()) d.native.install();
      const v = d.native.voice();
      return d.calls.start({
        agent_id: p.agent_id,
        voice: p.voice ?? v.gender,
        locale: p.locale ?? v.locale,
        thread: p.thread,
      });
    },
    "calls.prepare": () => {
      // Only where a call could start now: never downloads, never wakes a voice that is off.
      if (d && !callStatus().missing && d.engine.installed()) d.engine.prepare();
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
