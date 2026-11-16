import assert from "node:assert/strict";
import { test } from "node:test";
import { loadVoiceMeter } from "../../lazy.ts";

const { createCutter, wav } = await loadVoiceMeter();
const RATE = 16_000;

/** Seconds of a voice (a loud tone) or of a quiet room (faint noise). */
const voice = (s: number) =>
  Float32Array.from({ length: s * RATE }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 200 * i) / RATE));
const room = (s: number) => Float32Array.from({ length: s * RATE }, (_, i) => 0.002 * Math.sin(i * 1.7));

/** Feeds the audio in the microphone's small buffers; the pieces cut, in seconds, with whether they had voice. */
function cutAll(...parts: Float32Array[]) {
  const cutter = createCutter(RATE);
  const out: { seconds: number; speech: boolean }[] = [];
  for (const part of parts)
    for (let at = 0; at < part.length; at += 2048)
      for (const p of cutter.push(part.subarray(at, at + 2048)))
        out.push({ seconds: p.samples.length / RATE, speech: p.speech });
  const open = cutter.open();
  return { pieces: out, open: { seconds: open.samples.length / RATE, speech: open.speech } };
}

test("a piece ends at the first pause after a few seconds, never inside a word, and nothing is lost", () => {
  const { pieces, open } = cutAll(voice(6), room(0.5), voice(5), room(0.6), voice(3));
  assert.equal(pieces.length, 1);
  const [first] = pieces;
  // The pause at 6 s is too early; the one after 11.5 s ends it, in its middle.
  assert.ok(first && first.seconds > 11.5 && first.seconds < 12.1, `cut at ${first?.seconds}`);
  assert.equal(first?.speech, true);
  assert.ok(Math.abs((first?.seconds ?? 0) + open.seconds - 15.1) < 0.01);
  assert.equal(open.speech, true);
});

test("talking without a pause is still cut, every 25 seconds at most", () => {
  const { pieces, open } = cutAll(voice(60));
  assert.equal(pieces.length, 2);
  for (const p of pieces) assert.ok(p.seconds > 23 && p.seconds <= 25, `piece of ${p.seconds}s`);
  assert.ok(Math.abs(pieces.reduce((s, p) => s + p.seconds, 0) + open.seconds - 60) < 0.01);
});

test("a stretch of silence is a piece with no voice, so it is not sent to be transcribed", () => {
  const { pieces, open } = cutAll(room(11), voice(2));
  assert.equal(pieces[0]?.speech, false);
  assert.equal(open.speech, true);
});

test("the audio goes as a 16 kHz mono WAV, whatever rate the microphone runs at", () => {
  const out = wav(new Float32Array(48_000).fill(0.5), 48_000);
  const v = new DataView(out.buffer);
  assert.equal(new TextDecoder().decode(out.subarray(0, 4)), "RIFF");
  assert.equal(v.getUint32(24, true), 16_000);
  assert.equal(v.getUint32(40, true), 32_000);
  assert.equal(out.length, 44 + 32_000);
  assert.ok(Math.abs(v.getInt16(44 + 100, true) - 0.5 * 0x7fff) < 2);
});
