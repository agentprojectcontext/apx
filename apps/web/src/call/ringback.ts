// The ringing tone while a call connects, made here (a 425 Hz tone, one second on, three off) so no sound file ships.
// It stops as soon as the agent answers, before the call listens: the microphone never hears it as the owner.
const HZ = 425;
const ON_S = 1;
const PERIOD_S = 4;
const LEVEL = 0.12;

export function ringback(): { stop(): void } {
  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext();
  } catch {
    return { stop() {} };
  }
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = HZ;
  osc.connect(gain).connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05;
  // Ten minutes of rings scheduled ahead, each faded in and out so it never clicks.
  for (let at = t0; at < t0 + 600; at += PERIOD_S) {
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(LEVEL, at + 0.02);
    gain.gain.setValueAtTime(LEVEL, at + ON_S - 0.02);
    gain.gain.linearRampToValueAtTime(0, at + ON_S);
  }
  gain.gain.setValueAtTime(0, ctx.currentTime);
  osc.start(t0);
  return {
    stop() {
      const c = ctx;
      ctx = undefined;
      if (!c) return;
      try {
        osc.stop();
      } catch {}
      void c.close().catch(() => {});
    },
  };
}
