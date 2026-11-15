import assert from "node:assert/strict";
import { type SpawnOptions, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { wav16k } from "./audio.ts";
import { createServices } from "./registry.ts";
import { createWhisperCpp } from "./whisper-cpp.ts";

const FAKE = path.join(import.meta.dirname, "fake-whisper-server.test-support.mjs");
/** The stand-in is a node script: started through node, it runs on Windows too, where a script is not a program. */
const viaNode = ((file: string, args: readonly string[], options: SpawnOptions) =>
  spawn(process.execPath, [file, ...args], options)) as typeof spawn;

test("the words heard while recording come from whisper.cpp on this machine, and no file is kept", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const log = createLog("test", true);
  const whisperCpp = createWhisperCpp({
    log,
    command: FAKE,
    idleMs: 200,
    spawn: viaNode,
    toWav: async (a) => wav16k(a),
  });
  const services = createServices({
    store: env.core.store,
    secrets: env.core.secrets,
    home: env.home,
    log,
    whisperCpp,
  });
  const model = path.join(env.home, "ggml-small.bin");
  fs.writeFileSync(model, "model");
  const audio = Buffer.alloc(2000, 1);
  const dir = path.join(env.home, "media");
  const media = () => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : []);
  try {
    const cloud = {
      kind: "transcription",
      dialect: "openai-transcribe",
      label: "Cloud",
      base_url: "https://api.example.com",
      enabled: true,
      needs_key: true,
    } as const;
    services.set("cloud", cloud);
    assert.equal(await services.listen(audio, "audio/webm", AbortSignal.timeout(5000)), undefined);
    services.set("local", { ...cloud, dialect: "whisper-cpp", label: "Local", needs_key: false, model });
    services.order("transcription", ["local"]);
    const before = media();
    assert.equal(
      await services.listen(audio, "audio/webm", AbortSignal.timeout(10_000)),
      "heard audio with ggml-small.bin",
    );
    assert.deepEqual(media(), before);
  } finally {
    services.close();
    await env.core.close();
    await env.cleanup();
  }
});

test("with APX's voice first, the words heard while recording come from it, and none once it is not installed", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  let installed = true;
  const heard: { bytes: number; lang: string | undefined }[] = [];
  const services = createServices({
    store: env.core.store,
    secrets: env.core.secrets,
    home: env.home,
    log: createLog("test", true),
    voice: {
      installed: () => installed,
      speak: async () => ({ bytes: Buffer.alloc(0), mime: "audio/wav" }),
      transcribe: async (pcm, lang) => {
        heard.push({ bytes: pcm.length, lang });
        return "Roby, ¿descargás el último capítulo?";
      },
    },
    toPcm: async (audio) => Buffer.concat([audio, audio]),
  });
  const dir = path.join(env.home, "media");
  const media = () => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : []);
  try {
    services.set("apx-voice-ears", {
      kind: "transcription",
      dialect: "apx-voice",
      label: "APX",
      base_url: "http://127.0.0.1",
      enabled: true,
      needs_key: false,
    });
    const before = media();
    const audio = Buffer.alloc(1000, 1);
    assert.equal(
      await services.listen(audio, "audio/webm", AbortSignal.timeout(5000)),
      "Roby, ¿descargás el último capítulo?",
    );
    assert.deepEqual(heard, [{ bytes: 2000, lang: undefined }], "the recording reaches the voice as PCM");
    assert.deepEqual(media(), before);
    installed = false;
    assert.equal(await services.listen(audio, "audio/webm", AbortSignal.timeout(5000)), undefined);
  } finally {
    services.close();
    await env.core.close();
    await env.cleanup();
  }
});
