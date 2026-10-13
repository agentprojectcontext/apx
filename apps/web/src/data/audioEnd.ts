// The chime after an audio, fetched the first time one ends: the sounds stay out of the panel's first script.
export function audioEnded(): void {
  void import("../shell/sounds.ts").then((m) => m.audioEnded()).catch(() => {});
}
