// APX's own voice: whether it can run here, its download, whether it is on, its voice and the model calls talk with.

import type { NativeVoice, Params, VoiceStatus } from "@apx/protocol";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { refreshSpeech } from "./speech.ts";

type VoiceState = {
  /** Undefined until the first answer (or when this core does not answer). */
  status: VoiceStatus | undefined;
};

const voice = createStore<VoiceState>({ status: undefined });

export function useVoice(): VoiceStatus | undefined {
  return useSlice(voice, (s) => s.status);
}

/** Asks the core again; a core that does not have the voice yet leaves it unknown. */
export async function loadVoice(): Promise<void> {
  try {
    voice.set({ status: await client.call("voice.status", {}) });
  } catch {
    voice.set({ status: undefined });
  }
}

/** Starts (or retries) the download; its progress comes with `loadVoice`. */
export async function installVoice(): Promise<void> {
  voice.set({ status: await client.call("voice.install", {}) });
}

/** On or off, its voice, whether calls are offered, or the model calls talk with (`null`: the owner's main model). */
export async function setVoice(patch: Params<"voice.set">): Promise<void> {
  voice.set({ status: await client.call("voice.set", patch) });
  // Read-aloud buttons follow whether some voice speaks.
  if (patch.enabled !== undefined) void refreshSpeech();
}

/** The voice id `media.speak` takes for one of APX's own voices. */
export const voiceId = (v: NativeVoice): string => `${v.locale}-${v.gender}`;
