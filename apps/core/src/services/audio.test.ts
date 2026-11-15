import assert from "node:assert/strict";
import { type SpawnOptions, spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { toOggOpus, toPcm16k } from "./audio.ts";

const FAKE = path.join(import.meta.dirname, "fake-ffmpeg.test-support.mjs");
const viaNode = ((_cmd: string, args: readonly string[], options: SpawnOptions) =>
  spawn(process.execPath, [FAKE, ...args], options)) as typeof spawn;

test("a phone's voice note is decoded, not read as silence", async () => {
  const note = Buffer.from("m4a with its index at the end");
  assert.deepEqual(await toPcm16k(note, viaNode), note);
  assert.deepEqual(await toOggOpus(note, viaNode), note);
});

test("a recording that decodes to nothing fails, so the next engine is tried", async () => {
  await assert.rejects(toPcm16k(Buffer.from("silence"), viaNode), /no sound/);
});
