// Which tabs to close because nobody uses them: an open page keeps running (and taking memory) until it is closed.

/** How long a tab stays open off screen with no agent or owner using it. */
export const TAB_IDLE_MS = 10 * 60_000;

export type IdleCandidate = {
  id: string;
  /** Last time an agent or the owner did something with it, or it was on screen. */
  used: number;
  /** Not to be closed: an agent call is running on it, or the owner has it (taken over or handed to them). */
  locked: boolean;
};

/** The tabs unused for `idleMs` that are not on screen and not locked. */
export function idleTabs(
  tabs: readonly IdleCandidate[],
  now: number,
  onScreen: (id: string) => boolean,
  idleMs = TAB_IDLE_MS,
): string[] {
  return tabs.filter((t) => !t.locked && !onScreen(t.id) && now - t.used >= idleMs).map((t) => t.id);
}
