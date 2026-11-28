// Hearing the voice's name on this computer: an energy detector over 20 ms frames of 16 kHz PCM16 that cuts what was
// said into short clips, and the clip as WAV for voice.wake. Ported from the phone's listener; levels are PCM16 units.

export const RATE = 16_000;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (RATE * FRAME_MS) / 1000;

const LEAD_MS = 300;
const END_QUIET_MS = 450;
const MIN_SPEECH_MS = 350;
const MAX_UTTERANCE_MS = 1800;
/** Clips worth asking about: shorter is a cough or a click, longer is a conversation, not a name. */
const CLIP_MIN_MS = 600;
const CLIP_MAX_MS = 2500;
/** At most one check this often. */
const CHECK_EVERY_MS = 1500;
/** Starts high so the first frames never count as speech; it falls to the room's level within a few frames. */
const START_FLOOR = 400;

export function rms(frame: Int16Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (const v of frame) sum += v * v;
  return Math.sqrt(sum / frame.length);
}

export type Segmenter = {
  /** One 20 ms frame; returns a finished utterance (lead audio included), if this frame ended one. */
  push(frame: Int16Array): Int16Array | undefined;
  /** The room's level as it stands now. */
  floor(): number;
};

export function createSegmenter(): Segmenter {
  let floor = START_FLOOR;
  let lead: Int16Array[] = [];
  let utterance: Int16Array[] | undefined;
  let levels: number[] = [];
  let speechMs = 0;
  let quietMs = 0;
  const leadFrames = LEAD_MS / FRAME_MS;

  const reset = () => {
    lead = [];
    utterance = undefined;
    levels = [];
    speechMs = 0;
    quietMs = 0;
  };

  return {
    floor: () => floor,
    push(frame) {
      const level = rms(frame);
      if (level < floor) floor = floor * 0.7 + level * 0.3;
      if (!utterance) {
        if (level >= floor) floor = floor * 0.995 + level * 0.005;
        if (level > Math.max(floor * 4, floor + 88, 80)) {
          utterance = [...lead, frame];
          levels = [level];
          lead = [];
          speechMs = FRAME_MS;
          quietMs = 0;
          return undefined;
        }
        lead.push(frame);
        if (lead.length > leadFrames) lead.shift();
        return undefined;
      }
      utterance.push(frame);
      levels.push(level);
      if (level > Math.max(floor * 2.6, floor + 55, 80)) {
        speechMs += FRAME_MS;
        quietMs = 0;
      } else quietMs += FRAME_MS;
      const total = utterance.length * FRAME_MS;
      const ended = quietMs >= END_QUIET_MS;
      const cut = total >= MAX_UTTERANCE_MS;
      if ((ended && speechMs >= MIN_SPEECH_MS) || cut) {
        const clip = join(utterance);
        // Sound that never paused is likely the room (a fan, music): it raises the floor as quiet would have.
        if (cut && !ended) for (const l of levels) if (l >= floor) floor = floor * 0.995 + l * 0.005;
        reset();
        return clip;
      }
      // A blip too short to be a word.
      if (ended) reset();
      return undefined;
    },
  };
}

/** Whether a clip is worth a check now: long enough to be a name, short enough not to be talk, and not too soon. */
export function worthChecking(samples: number, lastCheckAt: number | undefined, now: number): boolean {
  const ms = (samples / RATE) * 1000;
  if (ms < CLIP_MIN_MS || ms > CLIP_MAX_MS) return false;
  return lastCheckAt === undefined || now - lastCheckAt >= CHECK_EVERY_MS;
}

function join(frames: Int16Array[]): Int16Array {
  const out = new Int16Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

/** 16 kHz mono PCM16 as a WAV file. */
export function encodeWav(pcm: Int16Array, rate = RATE): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i] ?? 0, true);
  return bytes;
}

export function base64(bytes: Uint8Array): string {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}
