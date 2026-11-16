// Dictation in pieces: the recording is cut at a pause every few seconds, so each piece becomes words while the person
// keeps talking and only the last few seconds are left when they stop.

/**
 * A piece ends at the first pause after MIN_S of audio; with no pause, by MAX_S at its quietest moment. Whisper reads
 * 30 seconds at a time, so a piece under that costs the same whatever its length: fewer, longer pieces.
 */
const MIN_S = 10;
const MAX_S = 25;
/** How long a quiet stretch counts as a pause, and how far back a piece with no pause looks for its quietest moment. */
const PAUSE_MS = 350;
const LOOK_BACK_MS = 1500;
const FRAME_MS = 20;
/** Less than this much voice in a piece is not sent: a model asked about silence makes words up. */
const SPEECH_MS = 200;
/** What transcription engines read best, and the smallest file for it. */
const WAV_RATE = 16_000;

export type Piece = { samples: Float32Array; speech: boolean };

function join(parts: Float32Array[], length: number): Float32Array {
  const all = new Float32Array(length);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

/** Cuts a stream of samples into pieces at pauses; `push` returns the pieces it closed. */
export function createCutter(rate: number) {
  const frame = Math.max(1, Math.round((rate * FRAME_MS) / 1000));
  const minFrames = (MIN_S * 1000) / FRAME_MS;
  const maxFrames = (MAX_S * 1000) / FRAME_MS;
  const pauseFrames = PAUSE_MS / FRAME_MS;
  const speechFrames = SPEECH_MS / FRAME_MS;
  let parts: Float32Array[] = [];
  let length = 0;
  /** Per full frame of the open piece: its loudness and whether it was voice. */
  let levels: number[] = [];
  let voiced: boolean[] = [];
  let filled = 0;
  let energy = 0;
  let quietRun = 0;
  /** The room's noise: follows quiet frames down at once and rises slowly, so a long sentence does not become it. */
  let floor = 0.004;

  const cut = (frames: number): Piece => {
    const all = join(parts, length);
    const at = frames * frame;
    const speech = voiced.slice(0, frames).filter(Boolean).length >= speechFrames;
    const piece = { samples: all.slice(0, at), speech };
    const rest = all.slice(at);
    parts = [rest];
    length = rest.length;
    levels = levels.slice(frames);
    voiced = voiced.slice(frames);
    quietRun = 0;
    return piece;
  };

  const closeFrame = (): Piece | undefined => {
    const level = Math.sqrt(energy / frame);
    filled = 0;
    energy = 0;
    floor = level < floor ? level : floor + (level - floor) * 0.0005;
    const loud = level >= Math.min(0.04, Math.max(0.008, floor * 3));
    levels.push(level);
    voiced.push(loud);
    quietRun = loud ? 0 : quietRun + 1;
    const n = levels.length;
    if (n >= minFrames && quietRun >= pauseFrames) return cut(n - Math.floor(quietRun / 2));
    if (n < maxFrames) return undefined;
    const from = Math.max(1, n - LOOK_BACK_MS / FRAME_MS);
    let quietest = n - 1;
    for (let i = from; i < n; i++) if ((levels[i] ?? 1) < (levels[quietest] ?? 1)) quietest = i;
    return cut(quietest + 1);
  };

  return {
    push(samples: Float32Array): Piece[] {
      parts.push(samples.slice());
      length += samples.length;
      const out: Piece[] = [];
      for (const s of samples) {
        energy += s * s;
        if (++filled === frame) {
          const piece = closeFrame();
          if (piece) out.push(piece);
        }
      }
      return out;
    },
    /** The piece still open, without closing it. */
    open(): Piece {
      return { samples: join(parts, length), speech: voiced.filter(Boolean).length >= speechFrames };
    },
  };
}

/** Samples as a 16 kHz mono 16-bit WAV. */
export function wav(samples: Float32Array, rate: number): Uint8Array {
  const n = Math.floor((samples.length * WAV_RATE) / rate);
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, WAV_RATE, true);
  v.setUint32(28, WAV_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 2, true);
  const step = rate / WAV_RATE;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const a = samples[j] ?? 0;
    const s = a + ((samples[j + 1] ?? a) - a) * (x - j);
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
  }
  return out;
}

const wavBlob = (pieces: Piece[], rate: number): Blob | undefined => {
  if (!pieces.some((p) => p.speech)) return undefined;
  const samples = join(
    pieces.map((p) => p.samples),
    pieces.reduce((sum, p) => sum + p.samples.length, 0),
  );
  return new Blob([wav(samples, rate) as Uint8Array<ArrayBuffer>], { type: "audio/wav" });
};

export type VoiceTap = {
  /** The audio from piece `index` on, the open one included; undefined when there is no voice in it. */
  since(index: number): Blob | undefined;
  /** Stops listening; the last piece (its index, and its audio when there is voice in it). */
  end(): { index: number; audio: Blob | undefined };
};

/**
 * Cuts what the microphone hears into pieces as it goes: `onPiece` gets each one's index and audio (undefined for a
 * silent piece, which needs no words). Throws where the browser cannot read the microphone's samples.
 */
export function startVoiceTap(
  stream: MediaStream,
  onPiece: (index: number, audio: Blob | undefined) => void,
): VoiceTap {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor, not a worklet: it needs no module file, and a 40 ms buffer is plenty for speech.
  const tap = context.createScriptProcessor(2048, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  const cutter = createCutter(context.sampleRate);
  const pieces: Piece[] = [];
  let on = true;
  tap.onaudioprocess = (e) => {
    if (!on) return;
    for (const piece of cutter.push(e.inputBuffer.getChannelData(0))) {
      pieces.push(piece);
      onPiece(pieces.length - 1, wavBlob([piece], context.sampleRate));
    }
  };
  source.connect(tap);
  tap.connect(mute);
  mute.connect(context.destination);
  void context.resume().catch(() => {});
  return {
    since: (index) => wavBlob([...pieces.slice(index), cutter.open()], context.sampleRate),
    end() {
      on = false;
      tap.onaudioprocess = null;
      source.disconnect();
      tap.disconnect();
      if (context.state !== "closed") void context.close().catch(() => {});
      const last = cutter.open();
      pieces.push(last);
      return { index: pieces.length - 1, audio: wavBlob([last], context.sampleRate) };
    },
  };
}
