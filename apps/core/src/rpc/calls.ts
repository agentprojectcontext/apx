// Voice calls from the panel (engine/calls.ts, services/voice-engine.ts, transport/voice-call.ts).
import type { Calls } from "../engine/calls.ts";
import { unavailable } from "../errors.ts";
import type { VoiceEngine } from "../services/voice-engine.ts";
import type { Handlers } from "./router.ts";

const NEEDS = {
  platform: "calls need a Mac with Apple silicon",
  uv: "calls need uv (brew install uv)",
  voice: "calls need a cloned voice in the voices folder",
} as const;

export function callHandlers(d: { calls: Calls; engine: VoiceEngine } | undefined) {
  return {
    "calls.status": () => {
      if (!d) return { ready: false, running: false, missing: "platform" as const };
      const s = d.engine.status();
      const live = d.calls.status().live;
      return {
        ready: s.ready,
        running: s.running,
        ...(s.missing ? { missing: s.missing } : {}),
        ...(live ? { live } : {}),
      };
    },
    "calls.start": (p) => {
      const missing = d ? d.engine.status().missing : "platform";
      if (!d || missing) throw unavailable(NEEDS[missing ?? "platform"]);
      return d.calls.start(p);
    },
    "calls.end": ({ thread_id }) => {
      d?.calls.end(thread_id);
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}
