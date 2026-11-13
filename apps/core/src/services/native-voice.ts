// APX's own voice as the owner sees it (voice.status / voice.install / voice.set): on by default wherever this machine
// runs it, downloaded on its own there, and then the first voice and the first transcription of the media services,
// so agents speak and hear with it unless the owner puts another service first. Other machines get none, and the
// owner's own services. See DECISIONS.md#d-226
import type { ModelRef, NativeVoice, ServiceSettings, VoiceStatus } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import type { Log } from "../log.ts";
import type { Services } from "./registry.ts";
import type { VoiceEngine } from "./voice-engine.ts";

const NATIVE_SPEECH = "apx-voice";
const NATIVE_EARS = "apx-voice-ears";

const BASE = "http://127.0.0.1";

const voiceId = (v: NativeVoice) => `${v.locale}-${v.gender}`;

export function createNativeVoice(deps: {
  store: Store;
  services: Services;
  engine: VoiceEngine;
  log: Log;
  /** Download on its own where the machine runs it well (off for a scratch core). */
  auto: boolean;
}) {
  const { store, services, engine } = deps;
  const settings = () => store.settings.read("voice");
  const save = (patch: Partial<ReturnType<typeof settings>>) => {
    const next = { ...settings(), ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    store.settings.write("voice", next);
  };

  /** The voice by default follows the owner's language: Argentine Spanish unless they write in English. */
  function voice(): NativeVoice {
    const set = settings().voice;
    if (set) return set;
    return { gender: "female", locale: store.settings.get("owner_language") === "en" ? "en-US" : "es-AR" };
  }

  const enabled = () => settings().enabled ?? engine.machine().tier !== "none";
  const usable = () => enabled() && !engine.machine().missing && engine.installed();

  /** The media services follow the voice: first of their kind while it can answer, gone while it cannot. */
  function sync(): void {
    const has = services.has;
    if (!usable()) {
      for (const id of [NATIVE_SPEECH, NATIVE_EARS]) if (has(id)) services.set(id, null);
      return;
    }
    const lang = voice().locale.slice(0, 2);
    const speech: ServiceSettings = {
      kind: "speech",
      dialect: "apx-voice",
      label: "APX",
      base_url: BASE,
      enabled: true,
      needs_key: false,
      voice: voiceId(voice()),
      language: lang,
    };
    const ears: ServiceSettings = { ...speech, kind: "transcription", voice: undefined };
    const fresh = !has(NATIVE_SPEECH);
    services.set(NATIVE_SPEECH, speech);
    services.set(NATIVE_EARS, ears);
    // Put first once, when it arrives; after that the owner's order stands.
    if (fresh) {
      services.order("speech", [NATIVE_SPEECH]);
      services.order("transcription", [NATIVE_EARS]);
    }
  }

  function status(): VoiceStatus {
    const m = engine.machine();
    const install = engine.install();
    const call_model = settings().call_model;
    return {
      tier: m.tier,
      memory_gb: m.memory_gb,
      ...(m.missing ? { missing: m.missing } : {}),
      enabled: enabled(),
      installed: engine.installed(),
      ...(install ? { install } : {}),
      running: engine.running(),
      voice: voice(),
      calls: settings().calls ?? true,
      ...(call_model ? { call_model } : {}),
    };
  }

  function install(): void {
    if (!engine.installed()) engine.startInstall();
  }

  /** At start: learn whether it is on disk, download it where it runs and is on, and set the services. */
  function boot(): void {
    const m = engine.machine();
    if (m.tier === "none" || m.missing) {
      sync();
      return;
    }
    // Models already in the shared download cache make this quick: it only checks them.
    if (!engine.installed() && deps.auto && enabled()) {
      deps.log.info({ tier: m.tier }, "downloading APX's voice");
      install();
    }
    sync();
  }

  // An install that ends sets the services up; checked now and then rather than wired into the engine.
  const watch = setInterval(() => {
    if (engine.installed() && enabled() && !services.has(NATIVE_SPEECH)) sync();
  }, 2000);
  watch.unref();

  return {
    boot,
    status,
    voice,
    enabled,
    usable,
    /** The model calls talk with, when the owner picked one. */
    callModel: (): ModelRef | undefined => settings().call_model,
    async install(): Promise<VoiceStatus> {
      install();
      return status();
    },
    set(p: {
      enabled?: boolean | undefined;
      voice?: NativeVoice | undefined;
      calls?: boolean | undefined;
      call_model?: ModelRef | null | undefined;
    }) {
      save({
        ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
        ...(p.calls !== undefined ? { calls: p.calls } : {}),
        ...(p.voice ? { voice: p.voice } : {}),
        ...(p.call_model !== undefined ? { call_model: p.call_model ?? undefined } : {}),
      });
      if (p.enabled && !engine.installed() && !engine.machine().missing) install();
      sync();
      return status();
    },
    close: () => clearInterval(watch),
  };
}

export type NativeVoiceSettings = ReturnType<typeof createNativeVoice>;
