import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { callHandlers } from "../rpc/calls.ts";
import { tempDir } from "../testkit/platform.ts";
import { createCallAudio } from "./call-audio.ts";
import { createNativeVoice } from "./native-voice.ts";
import { createServices } from "./registry.ts";
import { createVoiceEngine } from "./voice-engine.ts";

test("calls with configured services work on Linux without enabling or installing the Mac voice", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const log = createLog("test", true);
  const engine = createVoiceEngine({ log, home: env.home, platform: "linux", arch: "x64", uv: () => "uv" });
  const services = createServices({ store: env.core.store, secrets: env.core.secrets, home: env.home, log });
  const native = createNativeVoice({ store: env.core.store, services, engine, log, auto: false });
  const audio = createCallAudio({
    store: env.core.store,
    home: env.home,
    log,
    native,
    engine,
    services,
    uv: () => "uv",
  });
  const handlers = callHandlers({ ...audio, native, engine, calls: env.core.voice.calls });
  try {
    assert.equal(native.status().tier, "none");
    assert.equal(native.status().enabled, false);
    assert.equal(native.status().call_engine, "services");
    assert.equal(handlers["calls.status"]().missing, "speech");
    services.set("voice", {
      kind: "speech",
      dialect: "openai-speech",
      base_url: "http://127.0.0.1:5111/v1",
      label: "Custom voice",
      needs_key: false,
      enabled: true,
    });
    assert.equal(handlers["calls.status"]().missing, "transcription");
    services.set("ears", {
      kind: "transcription",
      dialect: "openai-transcribe",
      base_url: "http://127.0.0.1:8000/v1",
      label: "Custom transcription",
      needs_key: false,
      enabled: true,
    });
    const pinned = audio.callServices();
    assert.equal(pinned?.speech, "voice");
    assert.equal(pinned?.transcription, "ears");
    services.set("ears-remote", {
      kind: "transcription",
      dialect: "openai-transcribe",
      base_url: "http://example.test/v1",
      label: "Remote",
      needs_key: false,
      enabled: true,
    });
    services.order("transcription", ["ears-remote", "ears"]);
    assert.equal(pinned?.transcription, "ears", "an active call keeps its original audio recipient");
    assert.equal(audio.callServices()?.transcription, "ears-remote", "a later call uses the new order");
    const status = handlers["calls.status"]();
    assert.equal(status.ready, true);
    assert.equal(status.engine, "services");
    const { thread_id } = handlers["calls.start"]({});
    env.core.voice.calls.end(thread_id);
    assert.equal(engine.install(), undefined, "starting a service call never downloads MLX");
    assert.equal(native.status().enabled, false);
    native.set({ call_speech: "missing", call_transcription: "ears" });
    assert.equal(handlers["calls.status"]().missing, "speech", "a stale explicit selection never silently falls back");
    native.set({ call_speech: null, call_transcription: null });
    assert.equal(handlers["calls.status"]().ready, true);
    native.set({ calls: false });
    assert.equal(handlers["calls.status"]().missing, "disabled");
  } finally {
    audio.remote.close();
    native.close();
    services.close();
    engine.close();
    await env.core.close();
    await env.cleanup();
  }
});

test("CPU service engines are available on Windows and Linux independent of native voice hardware", (t) => {
  const dir = tempDir();
  t.after(() => dir.remove());
  const log = createLog("test", true);
  for (const platform of ["linux", "win32"] as const) {
    const engine = createVoiceEngine({
      services: true,
      home: dir.path,
      log,
      platform,
      arch: "x64",
      memoryGb: 8,
      uv: () => "uv",
    });
    try {
      assert.equal(engine.machine().missing, undefined);
      assert.equal(engine.installed(), true);
    } finally {
      engine.close();
    }
  }
});
