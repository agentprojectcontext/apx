// The "Listen on this computer" switch and why listening stopped (data/wake.ts holds the state the first screen reads).
import { WAKE_KEY, type WakeProblem, wake } from "../data/wake.ts";

export function setWakeListen(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(WAKE_KEY, "1");
    else window.localStorage.removeItem(WAKE_KEY);
  } catch {}
  // Turning it on again tries once more.
  wake.set({ on, problem: undefined });
}

export function stopWake(problem: WakeProblem): void {
  wake.set({ problem });
}
