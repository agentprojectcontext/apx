import { loadSounds } from "../lazy.ts";

// The chime after an audio, fetched the first time one ends: the sounds stay out of the panel's first script.
export function audioEnded(): void {
  void loadSounds()
    .then((m) => m.audioEnded())
    .catch(() => {});
}
