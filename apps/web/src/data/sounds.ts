// The panel's own sounds (this device only): a short chime when a voice note or read-aloud ends, and a sound when a
// notice arrives. Each can be muted in Config › Appearance.
import type { NotificationKind } from "@apx/protocol";
import audioEndUrl from "../assets/sounds/audio-end.mp3";
import messageUrl from "../assets/sounds/message.mp3";
import { soundsFor } from "./noticeSound.ts";
import { prefs } from "./prefs.ts";

function play(url: string): void {
  // A browser that has not seen a click yet refuses to play: that one sound is lost, nothing else.
  void new Audio(url).play().catch(() => {});
}

/** After a voice note or read-aloud finishes. */
export function audioEnded(): void {
  if (prefs.get().audioEndSound) play(audioEndUrl);
}

/** For a notice that just arrived. */
export function noticeArrived(kind: NotificationKind): void {
  if (soundsFor(kind, prefs.get().noticeSound)) play(messageUrl);
}

/** Plays one of them once, as Config › Sounds lets the owner hear it. */
export function previewSound(which: "audioEnd" | "notice"): void {
  play(which === "audioEnd" ? audioEndUrl : messageUrl);
}
