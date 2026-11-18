import path from "node:path";
import type { Store } from "../domain/store.ts";
import type { Log } from "../log.ts";
import type { NativeVoiceSettings } from "./native-voice.ts";
import type { Services } from "./registry.ts";
import { createUv } from "./uv.ts";
import { createVoiceEngine, type VoiceEngine } from "./voice-engine.ts";

export function createCallAudio(deps: {
  store: Store;
  home: string;
  log: Log;
  native: NativeVoiceSettings;
  engine: VoiceEngine;
  services: Services;
}) {
  const { native, engine, services, store } = deps;
  const remote = createVoiceEngine({
    log: deps.log,
    home: deps.home,
    services: true,
    uvProgram: createUv({ dir: path.join(deps.home, "bin"), log: deps.log }),
  });
  const eligible = (kind: "speech" | "transcription", id?: string) =>
    store.settings
      .read("services")
      .filter(
        (s) =>
          s.kind === kind &&
          s.enabled &&
          (!id || s.id === id) &&
          (!s.needs_key || services.hasKey(s.id)) &&
          (s.dialect !== "apx-voice" || engine.installed(kind === "speech" ? "all" : "ears")),
      );
  return {
    remote,
    callEngine: () => (native.status().call_engine === "services" ? remote : engine),
    callServices: () => {
      const s = native.status();
      return s.call_engine === "services"
        ? {
            services,
            speech: s.call_speech ?? eligible("speech")[0]?.id ?? "unavailable:speech",
            transcription: s.call_transcription ?? eligible("transcription")[0]?.id ?? "unavailable:transcription",
          }
        : undefined;
    },
    hasService: (kind: "speech" | "transcription", id: string | undefined) => eligible(kind, id).length > 0,
  };
}
