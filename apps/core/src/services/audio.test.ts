import assert from "node:assert/strict";
import { type SpawnOptions, spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { toOggOpus, toPcm16k, toWav16k } from "./audio.ts";

const FAKE = path.join(import.meta.dirname, "fake-ffmpeg.test-support.mjs");
const viaNode = ((_cmd: string, args: readonly string[], options: SpawnOptions) =>
  spawn(process.execPath, [FAKE, ...args], options)) as typeof spawn;

test("a phone's voice note is decoded, not read as silence", async () => {
  const note = Buffer.from("m4a with its index at the end");
  assert.deepEqual(await toPcm16k(note, "ffmpeg", viaNode), note);
  assert.deepEqual(await toOggOpus(note, "ffmpeg", viaNode), note);
});

test("a recording that decodes to nothing fails, so the next engine is tried", async () => {
  await assert.rejects(toPcm16k(Buffer.from("silence"), "ffmpeg", viaNode), /no sound/);
});

test("whisper.cpp gets a WAV whose header says 16 kHz mono and how long it is", async () => {
  const pcm = Buffer.alloc(32_000, 1);
  const wav = await toWav16k(pcm, "ffmpeg", viaNode);
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 16).toString(), "WAVEfmt ");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
});
