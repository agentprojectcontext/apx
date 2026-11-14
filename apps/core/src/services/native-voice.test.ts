import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { createNativeVoice } from "./native-voice.ts";
import { createServices } from "./registry.ts";
import type { VoiceEngine } from "./voice-engine.ts";

test("APX's voice keeps the place the owner gave it while new models download, and leaves only when turned off", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const log = createLog("test", true);
  let onDisk = true;
  let installs = 0;
  const engine = {
    machine: () => ({ tier: "light" as const, memory_gb: 24 }),
    installed: () => onDisk,
    install: () => undefined,
    running: () => false,
    canFull: () => true,
    restart() {},
    startInstall() {
      installs++;
    },
  } as unknown as VoiceEngine;
  const services = createServices({ store: env.core.store, secrets: env.core.secrets, home: env.home, log });
  const native = createNativeVoice({ store: env.core.store, services, engine, log, auto: true });
  const order = () =>
    env.core.store.settings
      .read("services")
      .filter((s) => s.kind === "transcription")
      .map((s) => s.id);
  try {
    services.set("local-whisper", {
      kind: "transcription",
      dialect: "whisper-cpp",
      label: "whisper.cpp",
      base_url: "http://127.0.0.1",
      enabled: true,
      needs_key: false,
    });
    native.boot();
    assert.deepEqual(order(), ["apx-voice-ears", "local-whisper"], "first when it arrives");
    services.order("transcription", ["local-whisper"]);

    onDisk = false; // an update brought a model this machine does not have yet
    native.boot();
    assert.equal(installs, 1, "the new model downloads on its own");
    assert.deepEqual(order(), ["local-whisper", "apx-voice-ears"], "the owner's order stands meanwhile");

    onDisk = true;
    native.set({ enabled: false });
    assert.deepEqual(order(), ["local-whisper"]);
  } finally {
    native.close();
    services.close();
    await env.core.close();
    await env.cleanup();
  }
});
