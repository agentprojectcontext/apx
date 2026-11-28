// Waking the super-agent by voice on this computer: whether it listens here (each device keeps its own switch) and, for
// this session, why it stopped. Changing it and the listener itself load late (call/wakeSwitch.ts, lazy.ts).
import { createStore, useSlice } from "./createStore.ts";

export const WAKE_KEY = "apx.wakeListen";

/** `mic`: the microphone was refused; `unavailable`: this computer can't tell what was said. */
export type WakeProblem = "mic" | "unavailable";

type WakeState = {
  /** The switch on this computer. */
  on: boolean;
  /** Why it stopped listening this session, though the switch is on. */
  problem?: WakeProblem | undefined;
};

function saved(): boolean {
  try {
    return window.localStorage.getItem(WAKE_KEY) === "1";
  } catch {
    return false;
  }
}

export const wake = createStore<WakeState>({ on: saved() });

export const useWake = <T>(select: (s: WakeState) => T): T => useSlice(wake, select);
