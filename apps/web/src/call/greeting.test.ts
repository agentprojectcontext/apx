import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ECHO_TAIL_MS,
  echoUntil,
  type HeldGreeting,
  inEcho,
  nextGreeting,
  parseWav,
  REFRESH_MS,
  RETRY_MS,
} from "./greeting.ts";
import { base64, encodeWav } from "./wakeVad.ts";

const wav = (pcm: number[], rate = 24_000) => encodeWav(Int16Array.from(pcm), rate);
const held = (key: string): HeldGreeting => ({ key, rate: 24_000, samples: new Float32Array(10) });

test("a WAV from the core comes out as its samples and rate", () => {
  const out = parseWav(wav([0, 16384, -32768, 32767]));
  assert.ok(out);
  assert.equal(out.rate, 24_000);
  assert.deepEqual(Array.from(out.samples), [0, 0.5, -1, 32767 / 0x8000]);
});

test("anything that is not a 16-bit PCM WAV holds nothing", () => {
  assert.equal(parseWav(new Uint8Array([1, 2, 3])), undefined);
  assert.equal(parseWav(new TextEncoder().encode("RIFF....WAVEdata")), undefined);
  const float = wav([1, 2]);
  float[20] = 3; // IEEE float format
  assert.equal(parseWav(float), undefined);
  assert.equal(parseWav(wav([])), undefined);
});

test("a new greeting is held and checked again in a few minutes", () => {
  const next = nextGreeting(undefined, { ready: true, key: "k1", data: base64(wav([100, 200])) });
  assert.equal(next.held?.key, "k1");
  assert.equal(next.held?.samples.length, 2);
  assert.equal(next.askIn, REFRESH_MS);
});

test("the same key without audio keeps the greeting held", () => {
  const mine = held("k1");
  const next = nextGreeting(mine, { ready: true, key: "k1" });
  assert.equal(next.held, mine);
  assert.equal(next.askIn, REFRESH_MS);
});

test("a greeting still being recorded drops the old one and asks again soon, so the call goes on as before", () => {
  const next = nextGreeting(held("k1"), { ready: false });
  assert.equal(next.held, undefined);
  assert.equal(next.askIn, RETRY_MS);
});

test("another key without audio holds nothing; a failed ask keeps what was held", () => {
  assert.equal(nextGreeting(held("k1"), { ready: true, key: "k2" }).held, undefined);
  const mine = held("k1");
  assert.deepEqual(nextGreeting(mine, undefined), { held: mine, askIn: REFRESH_MS });
  assert.equal(nextGreeting(undefined, { ready: true, key: "k1", data: "not base64!" }).held, undefined);
});

test("the microphone is not sent while the greeting plays, and a moment after", () => {
  const until = echoUntil(1000, 1.5);
  assert.equal(until, 1000 + 1500 + ECHO_TAIL_MS);
  assert.equal(inEcho(1000, until), true);
  assert.equal(inEcho(until - 1, until), true);
  assert.equal(inEcho(until, until), false);
  assert.equal(inEcho(1000, undefined), false);
});
