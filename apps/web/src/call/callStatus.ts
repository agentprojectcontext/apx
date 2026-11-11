import type { CallVoice } from "@apx/protocol";
import { calls } from "../data/calls.ts";
import { client } from "../data/client.ts";

let loading: Promise<void> | undefined;

/** Asks the core again whether calls can run here (when a call button first shows, and after each call). */
export function loadCallStatus(): Promise<void> {
  loading ??= client
    .call("calls.status", {})
    .then((status) => calls.set({ status }))
    .catch(() => undefined)
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

export function closeCall(): void {
  calls.set({ card: undefined, live: undefined });
  void loadCallStatus();
}

const VOICE_KEY = "apx.callVoice";

/** The voice chosen last on this device. */
export function savedVoice(): CallVoice {
  try {
    return window.localStorage.getItem(VOICE_KEY) === "male" ? "male" : "female";
  } catch {
    return "female";
  }
}

export function saveVoice(voice: CallVoice): void {
  try {
    window.localStorage.setItem(VOICE_KEY, voice);
  } catch {}
}
