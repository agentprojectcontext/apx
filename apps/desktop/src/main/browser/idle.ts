// Which tabs to close because nobody uses them: an open page keeps running (and taking memory) until it is closed.

/** How long a tab nobody looks at or drives stays open. */
export const TAB_IDLE_MS = 30 * 60_000;

export type IdleCandidate = {
  id: string;
  /** Last time an agent or the owner did something with it. */
  used: number;
  /** The owner took it over, or an agent handed it to them: theirs until they give it back. */
  owner: boolean;
};

/** The tabs unused for `idleMs` that are not on screen and not in the owner's hands. */
export function idleTabs(
  tabs: readonly IdleCandidate[],
  now: number,
  onScreen: (id: string) => boolean,
  idleMs = TAB_IDLE_MS,
): string[] {
  return tabs.filter((t) => !t.owner && !onScreen(t.id) && now - t.used >= idleMs).map((t) => t.id);
}
