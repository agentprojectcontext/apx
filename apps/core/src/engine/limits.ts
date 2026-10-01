// Every limit on agents acting on their own, in one place.

/** How deep delegations nest: the owner's agent → a helper → the helper's helper. */
export const MAX_DEPTH = 2;
/** Delegations running at once from one thread. */
export const MAX_ACTIVE_DELEGATIONS = 3;
/** How long a delegated run may work. */
export const A2A_DEADLINE_MS = 10 * 60_000;
/** Turns agents may start without the owner (delegations, results waking callers) in one conversation tree,
 *  counted since the owner last wrote in it. Past it the chain pauses until they write. */
export const MAX_UNATTENDED_RUNS = 16;
/** Tokens those unattended turns may spend before the chain pauses. */
export const MAX_UNATTENDED_TOKENS = 600_000;
