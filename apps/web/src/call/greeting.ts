// The greeting this computer plays the moment it hears its name (voice.greeting), held in memory while it listens, and
// what follows from holding one: the quick call starts `greeted` and the microphone is not sent while it plays.

/** How often a held greeting is checked again (the voice, its language or the owner's name may have changed). */
export const REFRESH_MS = 7 * 60_000;
/** Asked again this soon while the greeting is still being recorded. */
export const RETRY_MS = 20_000;
/** After the greeting ends, the microphone stays unsent a moment longer: the room's echo and frames still in flight. */
export const ECHO_TAIL_MS = 300;

export type HeldGreeting = { key: string; rate: number; samples: Float32Array<ArrayBuffer> };

export type GreetingAnswer = { ready: boolean; key?: string | undefined; data?: string | undefined };

/**
 * What to hold after asking (`answer` undefined: the ask failed) and when to ask again. A greeting still being recorded
 * drops the one held, which speaks with the voice before the change.
 */
export function nextGreeting(
  held: HeldGreeting | undefined,
  answer: GreetingAnswer | undefined,
): { held: HeldGreeting | undefined; askIn: number } {
  if (!answer) return { held, askIn: REFRESH_MS };
  if (!answer.ready || !answer.key) return { held: undefined, askIn: RETRY_MS };
  if (answer.data) {
    const wav = parseWav(fromBase64(answer.data));
    return wav ? { held: { key: answer.key, ...wav }, askIn: REFRESH_MS } : { held: undefined, askIn: REFRESH_MS };
  }
  // No audio back: unchanged when it is the key held, otherwise nothing to play.
  return held?.key === answer.key ? { held, askIn: REFRESH_MS } : { held: undefined, askIn: RETRY_MS };
}

/** When the microphone may be sent again, for a greeting of `durationS` that started playing at `startedAt` (ms). */
export const echoUntil = (startedAt: number, durationS: number): number =>
  startedAt + Math.ceil(durationS * 1000) + ECHO_TAIL_MS;

/** Whether audio heard at `now` is the greeting's own echo. */
export const inEcho = (now: number, until: number | undefined): boolean => until !== undefined && now < until;

function fromBase64(text: string): Uint8Array {
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

/** A 16-bit PCM WAV as samples in [-1, 1) (the first channel only); anything else is undefined. */
export function parseWav(bytes: Uint8Array): { rate: number; samples: Float32Array<ArrayBuffer> } | undefined {
  if (bytes.length < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return undefined;
  let fmt: { channels: number; rate: number } | undefined;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && size >= 16) {
      const format = view.getUint16(body, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || bits !== 16) return undefined;
      fmt = { channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true) };
    } else if (id === "data" && fmt && fmt.channels > 0 && fmt.rate > 0) {
      const end = Math.min(bytes.length, body + size);
      const frames = Math.floor((end - body) / (2 * fmt.channels));
      if (!frames) return undefined;
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = view.getInt16(body + i * 2 * fmt.channels, true) / 0x8000;
      return { rate: fmt.rate, samples };
    }
    // Chunks are padded to an even size.
    at = body + size + (size & 1);
  }
  return undefined;
}
