// The phone's own sounds: a short chime when a voice note ends, and the one notices arrive with. Which of them
// sound is the owner's choice on this phone (Settings › Sounds), kept across launches.
import { createAudioPlayer } from "expo-audio";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { isNoticeSound, type NoticeSound } from "./noticeSound";

export type SoundPrefs = { audioEnd: boolean; notice: NoticeSound };

const KEY = "apx.sounds";
let current: SoundPrefs = { audioEnd: true, notice: "all" };
const listeners = new Set<(prefs: SoundPrefs) => void>();

SecureStore.getItemAsync(KEY)
  .then((raw) => {
    const stored = JSON.parse(raw ?? "{}") as Partial<SoundPrefs>;
    current = { audioEnd: stored.audioEnd !== false, notice: isNoticeSound(stored.notice) ? stored.notice : "all" };
    for (const listen of listeners) listen(current);
  })
  .catch(() => {});

export const soundPrefs = (): SoundPrefs => current;

export function setSoundPrefs(patch: Partial<SoundPrefs>): void {
  current = { ...current, ...patch };
  for (const listen of listeners) listen(current);
  SecureStore.setItemAsync(KEY, JSON.stringify(current)).catch(() => {});
}

export function useSoundPrefs(): SoundPrefs {
  const [prefs, setPrefs] = useState(current);
  useEffect(() => {
    listeners.add(setPrefs);
    setPrefs(current);
    return () => {
      listeners.delete(setPrefs);
    };
  }, []);
  return prefs;
}

const AUDIO_END = require("../assets/sounds/audio-end.mp3");
const MESSAGE = require("../assets/sounds/message.wav");

function play(source: number): void {
  try {
    const player = createAudioPlayer(source);
    const done = player.addListener("playbackStatusUpdate", (status) => {
      if (!status.didJustFinish) return;
      done.remove();
      player.remove();
    });
    player.play();
  } catch {
    // No audio right now (another app holds it): this one sound is lost, nothing else.
  }
}

/** After a voice note or an audio file finishes. */
export function audioEnded(): void {
  if (current.audioEnd) play(AUDIO_END);
}

/** Plays one of them once, as Settings lets the owner hear it. */
export function previewSound(which: "audioEnd" | "notice"): void {
  play(which === "audioEnd" ? AUDIO_END : MESSAGE);
}
