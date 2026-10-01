import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLog } from "../log.ts";
import { createWhisperCpp } from "./whisper-cpp.ts";

const FAKE = path.join(import.meta.dirname, "fake-whisper-server.test-support.mjs");

test("whisper.cpp starts on the first voice note and is reused", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-whisper-"));
  const model = path.join(dir, "ggml-small.bin");
  fs.writeFileSync(model, "model");
  const w = createWhisperCpp({ log: createLog("test", true), command: FAKE, idleMs: 200 });
  try {
    assert.equal(w.available(model), true);
    assert.equal(w.available(path.join(dir, "missing.bin")), false);
    const audio = { bytes: Buffer.alloc(2000, 1), mime: "audio/ogg", model };
    assert.equal(await w.transcribe(audio, AbortSignal.timeout(10_000)), "heard audio with ggml-small.bin");
    assert.equal(await w.transcribe(audio, AbortSignal.timeout(10_000)), "heard audio with ggml-small.bin");
    await assert.rejects(
      w.transcribe({ ...audio, model: path.join(dir, "nope.bin") }, AbortSignal.timeout(5000)),
      /no model file/,
    );
  } finally {
    w.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("without the program it says how to get it", async () => {
  const w = createWhisperCpp({ log: createLog("test", true), command: "/nowhere/whisper-server" });
  await assert.rejects(
    w.transcribe({ bytes: Buffer.alloc(10), mime: "audio/ogg", model: "/tmp/x.bin" }, AbortSignal.timeout(2000)),
    /not installed \(brew install whisper-cpp\)/,
  );
  w.close();
});
