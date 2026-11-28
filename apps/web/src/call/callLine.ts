// A call's audio in the browser: the microphone up to the core as 16 kHz PCM16, the voice down as 24 kHz PCM16 played
// back to back, and the live frames (CallFrame in packages/protocol/src/call-methods.ts) handed to the card.
import type { CallFrame } from "@apx/protocol";
import { inEcho } from "./greeting.ts";

const UP_RATE = 16_000;
const DOWN_RATE = 24_000;
/** Lead before the first queued chunk plays, so the next one arrives before this one ends. */
const LEAD_S = 0.05;
/** What a greeted call keeps of the microphone until its socket opens (~100 ms each: ten seconds). */
const HELD_FRAMES = 100;

/**
 * A worklet named `name` that averages the input over each 16 kHz sample's span and posts `samples` of PCM16 at a time
 * (the call sends ~100 ms; the wake listener reads 20 ms frames).
 */
export const upWorklet = (name: string, samples: number): string => `
class Up extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${UP_RATE};
    this.t = 0;
    this.acc = 0;
    this.n = 0;
    this.out = new Int16Array(${samples});
    this.at = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.n++;
      this.t += 1;
      if (this.t < this.ratio) continue;
      this.t -= this.ratio;
      const v = Math.max(-1, Math.min(1, this.acc / this.n));
      this.acc = 0;
      this.n = 0;
      this.out[this.at++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.at === this.out.length) {
        this.port.postMessage(this.out.buffer, [this.out.buffer]);
        this.out = new Int16Array(${samples});
        this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(name)}, Up);
`;

const WORKLET = upWorklet("apx-call-up", UP_RATE / 10);

export type LineEvents = {
  frame(f: CallFrame): void;
  /** The socket closed; `ended` says whether an end frame came first. */
  closed(ended: boolean): void;
};

export type CallLine = {
  setMuted(muted: boolean): void;
  setSound(on: boolean): void;
  hangUp(): void;
};

/** The microphone, asked for before the call is placed: refused, no call starts. */
export async function openMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
}

/**
 * Connects the call's socket and its audio both ways; `hangUp` (or the socket closing) releases everything.
 * `greetedUntil`: this computer greeted the owner, so nothing is sent until then (ms), and what is said after it is
 * kept until the socket opens: the voice hears it once it loads.
 */
export async function openLine(
  mic: MediaStream,
  ticket: string,
  on: LineEvents,
  greetedUntil?: number,
): Promise<CallLine> {
  let ws: WebSocket | undefined;
  const early: ArrayBuffer[] = [];
  let muted = false;
  let released = false;
  let ended = false;
  const upCtx = new AudioContext();
  const downCtx = new AudioContext({ sampleRate: DOWN_RATE });
  const gain = downCtx.createGain();
  const playing = new Set<AudioBufferSourceNode>();
  let nextTime = 0;
  let source: MediaStreamAudioSourceNode | undefined;
  let up: AudioWorkletNode | undefined;
  let out: { close(): void } | undefined;

  const flush = () => {
    for (const node of playing) {
      try {
        node.stop();
      } catch {}
    }
    playing.clear();
    nextTime = 0;
  };
  const release = () => {
    if (released) return;
    released = true;
    flush();
    for (const track of mic.getTracks()) track.stop();
    if (up) up.port.onmessage = null;
    source?.disconnect();
    out?.close();
    void upCtx.close().catch(() => undefined);
    void downCtx.close().catch(() => undefined);
  };

  try {
    // Up: the microphone, resampled in a worklet.
    const workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await upCtx.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
    source = upCtx.createMediaStreamSource(mic);
    up = new AudioWorkletNode(upCtx, "apx-call-up", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    up.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (muted || inEcho(Date.now(), greetedUntil)) return;
      if (ws?.readyState === WebSocket.OPEN) ws.send(e.data);
      else if (greetedUntil !== undefined && early.length < HELD_FRAMES) early.push(e.data);
    };
    source.connect(up);
    // Down: each chunk scheduled right after the one before.
    out = await echoSafeOutput(downCtx, gain);
    // A call starts from a click, which lets both contexts run.
    void upCtx.resume().catch(() => undefined);
    void downCtx.resume().catch(() => undefined);
  } catch (err) {
    release();
    throw err;
  }

  const play = (data: ArrayBuffer) => {
    const pcm = new Int16Array(data, 0, data.byteLength >> 1);
    if (!pcm.length || released) return;
    const buffer = downCtx.createBuffer(1, pcm.length, DOWN_RATE);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] ?? 0) / 0x8000;
    const node = downCtx.createBufferSource();
    node.buffer = buffer;
    node.connect(gain);
    nextTime = Math.max(nextTime, downCtx.currentTime + LEAD_S);
    node.start(nextTime);
    nextTime += buffer.duration;
    playing.add(node);
    node.onended = () => playing.delete(node);
  };

  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${scheme}//${window.location.host}/voice-call?ticket=${encodeURIComponent(ticket)}`);
  ws = socket;
  socket.binaryType = "arraybuffer";
  socket.onopen = () => {
    for (const frame of early.splice(0)) socket.send(frame);
  };
  socket.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
    if (typeof e.data !== "string") {
      play(e.data);
      return;
    }
    let frame: CallFrame;
    try {
      frame = JSON.parse(e.data) as CallFrame;
    } catch {
      return;
    }
    if (frame.type === "interrupted") flush();
    if (frame.type === "end") ended = true;
    on.frame(frame);
  };
  socket.onclose = () => {
    release();
    on.closed(ended);
  };

  return {
    setMuted(next) {
      muted = next;
    },
    setSound(next) {
      gain.gain.value = next ? 1 : 0;
    },
    hangUp() {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "hangup" }));
      socket.close();
      release();
    },
  };
}

/**
 * Where the voice plays. Chrome's echo canceller ignores Web Audio output (crbug.com/687574), so the microphone would
 * hear the voice: it goes through a WebRTC loopback on this page and plays from an <audio> element, which the canceller
 * does hear. If that fails, it plays straight out.
 */
async function echoSafeOutput(ctx: AudioContext, gain: GainNode): Promise<{ close(): void }> {
  const sink = ctx.createMediaStreamDestination();
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  const el = new Audio();
  const close = () => {
    el.pause();
    el.srcObject = null;
    a.close();
    b.close();
    gain.disconnect();
  };
  try {
    gain.connect(sink);
    a.onicecandidate = (e) => {
      if (e.candidate) void b.addIceCandidate(e.candidate).catch(() => undefined);
    };
    b.onicecandidate = (e) => {
      if (e.candidate) void a.addIceCandidate(e.candidate).catch(() => undefined);
    };
    const remote = new Promise<MediaStream>((resolve) => {
      b.ontrack = (e) => resolve(e.streams[0] ?? new MediaStream([e.track]));
    });
    for (const track of sink.stream.getAudioTracks()) a.addTrack(track, sink.stream);
    const offer = await a.createOffer();
    await a.setLocalDescription(offer);
    await b.setRemoteDescription(offer);
    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription({ type: "answer", sdp: highBitrate(answer.sdp ?? "") });
    el.srcObject = await within(remote, 3000);
    await el.play();
    return { close };
  } catch {
    close();
    const direct = ctx.createGain();
    gain.connect(direct);
    direct.connect(ctx.destination);
    return { close: () => gain.disconnect() };
  }
}

/** Asks the loopback's Opus for voice quality rather than its default call bitrate. */
function highBitrate(sdp: string): string {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  return fmtp.test(sdp)
    ? sdp.replace(fmtp, (_line, params: string) => `a=fmtp:${pt} ${params};maxaveragebitrate=128000`)
    : sdp.replace(/(a=rtpmap:\d+ opus\/48000[^\r\n]*)/i, `$1\r\na=fmtp:${pt} maxaveragebitrate=128000`);
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}
