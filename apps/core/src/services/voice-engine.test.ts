import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { createVoiceEngine, type VoiceConfig } from "./voice-engine.ts";

const quiet = { info() {}, warn() {}, error() {} };
const config = (voices: string): VoiceConfig => ({
  llmUrl: "http://127.0.0.1:1",
  llmModel: "m",
  llmKind: "ollama",
  voices,
  female: "ana",
  male: "beto",
  ttsModel: "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
});

test("calls say what this machine is missing, and nothing is started to find out", (t) => {
  const tmp = tempDir();
  t.after(() => tmp.remove());
  const dir = tmp.path;
  let spawned = 0;
  const spawn = (() => {
    spawned++;
    throw new Error("not in this test");
  }) as unknown as typeof import("node:child_process").spawn;
  const on = (platform: NodeJS.Platform, arch: string) =>
    createVoiceEngine({ log: quiet, config: config(dir), home: dir, platform, arch, spawn });

  const linux = on("linux", "x64");
  assert.equal(linux.status().missing, "platform");
  linux.close();

  const mac = on("darwin", "arm64");
  const uv = mac.status().missing;
  if (uv !== "uv") {
    assert.equal(uv, "voice", "no cloned voice in the folder yet");
    fs.writeFileSync(path.join(dir, "beto.wav"), "");
    assert.deepEqual(mac.status(), { ready: true, running: false, missing: undefined });
  }
  assert.equal(mac.loading(), true, "the first call loads the engine");
  mac.close();
  assert.equal(spawned, 0);
});
