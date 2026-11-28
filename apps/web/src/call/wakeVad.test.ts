import assert from "node:assert/strict";
import { test } from "node:test";
import { createSegmenter, encodeWav, FRAME_MS, FRAME_SAMPLES, RATE, rms, worthChecking } from "./wakeVad.ts";

/** A 20 ms frame of a square wave at `level` (its rms). */
const frame = (level: number) => {
  const f = new Int16Array(FRAME_SAMPLES);
  for (let i = 0; i < f.length; i++) f[i] = i % 2 ? level : -level;
  return f;
};
const ms = (n: number) => n / FRAME_MS;

/** Feeds `level` for `duration` ms; returns the clips that came out. */
function feed(seg: ReturnType<typeof createSegmenter>, level: number, duration: number): Int16Array[] {
  const out: Int16Array[] = [];
  for (let i = 0; i < ms(duration); i++) {
    const clip = seg.push(frame(level));
    if (clip) out.push(clip);
  }
  return out;
}

test("the room's level falls fast to a quiet room and nothing is heard in it", () => {
  const seg = createSegmenter();
  assert.deepEqual(feed(seg, 30, 2000), []);
  assert.ok(seg.floor() < 40, `floor ${seg.floor()}`);
  assert.equal(rms(frame(123)), 123);
});

test("a word in a quiet room comes out once it ends, with the lead before it", () => {
  const seg = createSegmenter();
  feed(seg, 30, 1000);
  assert.deepEqual(feed(seg, 2000, 700), []);
  const clips = feed(seg, 30, 600);
  assert.equal(clips.length, 1);
  const clipMs = ((clips[0]?.length ?? 0) / RATE) * 1000;
  // 300 ms of lead, the word, and the 450 ms of quiet that ended it.
  assert.ok(clipMs >= 1400 && clipMs <= 1500, `clip ${clipMs} ms`);
});

test("a blip shorter than a word is dropped", () => {
  const seg = createSegmenter();
  feed(seg, 30, 1000);
  feed(seg, 2000, 100);
  assert.deepEqual(feed(seg, 30, 1000), []);
});

test("talk that goes on is cut at 1.8 s", () => {
  const seg = createSegmenter();
  feed(seg, 30, 1000);
  const clips = feed(seg, 2000, 2000);
  assert.equal(clips.length, 1);
  assert.ok(((clips[0]?.length ?? 0) / RATE) * 1000 <= 1800 + 300);
});

test("a steady noise raises the level slowly and stops counting as speech", () => {
  const seg = createSegmenter();
  feed(seg, 30, 1000);
  // A fan turns on: at first it sounds like talk, then it is the room.
  feed(seg, 400, 20_000);
  assert.deepEqual(feed(seg, 400, 3000), []);
});

test("only clips the length of a name are checked, one every 1.5 s", () => {
  assert.equal(worthChecking(RATE * 0.5, undefined, 0), false);
  assert.equal(worthChecking(RATE * 1, undefined, 0), true);
  assert.equal(worthChecking(RATE * 3, undefined, 0), false);
  assert.equal(worthChecking(RATE * 1, 1000, 2000), false);
  assert.equal(worthChecking(RATE * 1, 1000, 2500), true);
});

test("a clip goes as a 16 kHz mono 16-bit WAV", () => {
  const wav = encodeWav(new Int16Array([1, -1, 300]));
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), "WAVE");
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(48, true), 300);
  assert.equal(wav.length, 50);
});
