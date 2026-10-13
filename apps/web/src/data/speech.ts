// Reading a message aloud with the owner's voice service: whether one is set up, and the one message playing now.
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { mediaUrl } from "./media.ts";
import { audioEnded } from "./sounds.ts";

/** media.speak takes at most this many characters. */
const SPEAK_CHARS = 4000;

type SpeechState = {
  /** Unknown until the first check; true while an enabled voice service exists. */
  ready: boolean | undefined;
  /** The key of what is being read (a message's bubble), and whether its audio is still being made. */
  playing: string | undefined;
  loading: boolean;
};

const speech = createStore<SpeechState>({ ready: undefined, playing: undefined, loading: false });
let checking: Promise<void> | undefined;
let audio: HTMLAudioElement | undefined;

/** Asks the core again whether a voice is set up (after the owner changes services). */
export function refreshSpeech(): Promise<void> {
  checking = client
    .call("services.list", { kind: "speech" })
    .then((r) => speech.set({ ready: r.services.some((s) => s.enabled) }))
    .catch(() => speech.set({ ready: false }));
  return checking;
}

export function useSpeechReady(): boolean | undefined {
  if (!checking) void refreshSpeech();
  return useSlice(speech, (s) => s.ready);
}

/** "playing" | "loading" for this key, else undefined. */
export function useSpeaking(key: string): "playing" | "loading" | undefined {
  return useSlice(speech, (s) => (s.playing !== key ? undefined : s.loading ? "loading" : "playing"));
}

export function stopSpeaking(): void {
  audio?.pause();
  audio = undefined;
  speech.set({ playing: undefined, loading: false });
}

/** Reads `text` aloud as plain words; starting another stops the one playing. Throws when no voice answers. */
export async function speak(key: string, text: string): Promise<void> {
  stopSpeaking();
  speech.set({ playing: key, loading: true });
  try {
    const r = await client.call("media.speak", { text: plainWords(text).slice(0, SPEAK_CHARS) });
    if (speech.get().playing !== key) return;
    const player = new Audio(await mediaUrl(r.media.id));
    audio = player;
    player.onended = () => {
      if (audio !== player) return;
      stopSpeaking();
      audioEnded();
    };
    speech.set({ loading: false });
    await player.play();
  } catch (e) {
    if (speech.get().playing === key) stopSpeaking();
    throw e;
  }
}

/** Markdown as it would be said: no code fences, link targets, emphasis marks or list bullets. */
export function plainWords(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
