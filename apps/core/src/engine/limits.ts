// Every limit on agents acting on their own, in one place.
import type { Store } from "../domain/store.ts";

/**
 * How deep delegations nest: the owner's agent → a helper, and no further. An agent answering another one (a
 * delegation, a consult) does the work itself and asks nobody else (DECISIONS.md#d-074).
 */
export const MAX_DEPTH = 1;
/** Delegations running at once from one thread. */
export const MAX_ACTIVE_DELEGATIONS = 3;
/** How long a delegated run may work. */
export const A2A_DEADLINE_MS = 10 * 60_000;
/** Turns agents may start without the owner (delegations, results waking callers) in one conversation tree,
 *  counted since the owner last wrote in it. Past it the chain pauses until they write. The owner can change it
 *  (`agents.set_limits`, setting "agent_limits"); 0 = no limit. */
export const MAX_UNATTENDED_RUNS = 16;
/** Tokens those unattended turns may spend before the chain pauses. */
export const MAX_UNATTENDED_TOKENS = 600_000;

/** The limits in force: the owner's, else the defaults above. */
export function unattendedLimits(store: Store): { runs: number; tokens: number } {
  const s = store.settings.read("agent_limits");
  return { runs: s.runs ?? MAX_UNATTENDED_RUNS, tokens: s.tokens ?? MAX_UNATTENDED_TOKENS };
}
