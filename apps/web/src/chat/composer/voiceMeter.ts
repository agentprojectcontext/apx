/** RMS amplitude from the mic; silence stays flat instead of playing a decorative animation. */
export function voiceLevel(samples: Uint8Array): number {
  if (!samples.length) return 0;
  let energy = 0;
  for (const sample of samples) energy += ((sample - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(energy / samples.length) * 4);
}

export function startVoiceMeter(
  stream: MediaStream,
  update: (meter: { levels: number[]; seconds: number }) => void,
): () => void {
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  try {
    context = new AudioContext();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    void context.resume().catch(() => {});
  } catch {
    source?.disconnect();
    void context?.close().catch(() => {});
    analyser = undefined;
  }
  const samples = new Uint8Array(256);
  const levels = Array<number>(16).fill(0);
  const started = performance.now();
  const timer = window.setInterval(() => {
    analyser?.getByteTimeDomainData(samples);
    levels.shift();
    levels.push(analyser ? voiceLevel(samples) : 0);
    update({ levels: [...levels], seconds: Math.floor((performance.now() - started) / 1000) });
  }, 80);
  return () => {
    window.clearInterval(timer);
    source?.disconnect();
    if (context?.state !== "closed") void context?.close().catch(() => {});
  };
}
