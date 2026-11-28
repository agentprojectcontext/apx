// The phrases that wake the super-agent, as Settings › Voz edits them. One list shared with the computer (D-285): an
// empty list means the usual ones, which the core makes from the super-agent's name.

const MIN = 2;
const MAX = 60;
const MOST = 12;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What the core uses when the owner set none (apps/core/src/engine/wake.ts). */
export function usualWakeWords(name: string): string[] {
  const n = name.trim();
  return n ? [`Ok ${n}`, `Che ${n}`, `Hey ${n}`] : [];
}

/** Whether the list is the usual one: nothing set, or exactly the phrases the core makes from the name. */
export function isUsual(words: readonly string[], name: string): boolean {
  const usual = usualWakeWords(name);
  return words.length === 0 || (words.length === usual.length && words.every((w, i) => same(w, usual[i] ?? "")));
}

/** The list with one more phrase; the same list when it is too short or long, already there, or the list is full. */
export function addPhrase(words: readonly string[], typed: string): string[] {
  const phrase = typed.trim().replace(/\s+/g, " ");
  if (phrase.length < MIN || phrase.length > MAX || words.length >= MOST) return [...words];
  if (words.some((w) => same(w, phrase))) return [...words];
  return [...words, phrase];
}

export function removePhrase(words: readonly string[], phrase: string): string[] {
  return words.filter((w) => !same(w, phrase));
}

/**
 * What the screen shows from two answers read together. The phrases need only `voice.status`; when `calls.status`
 * fails too it stays unknown rather than wiping the phrases. Both failing: the core could not be read.
 */
export type VoiceRead =
  | { state: "loading" }
  | { state: "unreachable" }
  | { state: "loaded"; wake_words: string[]; ready: boolean | undefined; preparing: boolean };

export function readVoice(
  voice: PromiseSettledResult<{ wake_words?: string[]; greeting?: string }>,
  calls: PromiseSettledResult<{ ready: boolean }>,
): VoiceRead {
  if (voice.status === "rejected") return { state: "unreachable" };
  return {
    state: "loaded",
    wake_words: voice.value.wake_words ?? [],
    ready: calls.status === "fulfilled" ? calls.value.ready : undefined,
    preparing: voice.value.greeting === "preparing",
  };
}
