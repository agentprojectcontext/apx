// Every limit on agents acting on their own, in one place.
import type { Store } from "../domain/store.ts";

/**
 * How deep delegations nest: the owner's agent → a helper, and no further. An agent answering another one (a
 * delegation, a consult) does the work itself and asks nobody else (DECISIONS.md#d-074).
 */
export const MAX_DEPTH = 1;
/** Delegations running at once from one thread; past it the next ones wait in a queue (DECISIONS.md#d-094). */
export const MAX_ACTIVE_DELEGATIONS = 3;
/** How long a delegated run may work. */
export const A2A_DEADLINE_MS = 10 * 60_000;
/** Turns agents may start without the owner (delegations, results waking callers) in one conversation tree,
 *  counted since the owner last wrote in it. Past it the chain pauses until they write. The owner can change it
 *  (`agents.set_limits`, setting "agent_limits"); 0 = no limit. */
export const MAX_UNATTENDED_RUNS = 30;
/** Fresh tokens those unattended turns may spend before the chain pauses: input read from a provider's cache is not
 *  counted (domain/runs.ts). Sized for a few helpers reading a codebase in parallel and the summary after. */
export const MAX_UNATTENDED_TOKENS = 1_500_000;

/** The limits in force: the owner's, else the defaults above. */
export function unattendedLimits(store: Store): { runs: number; tokens: number } {
  const s = store.settings.read("agent_limits");
  return { runs: s.runs ?? MAX_UNATTENDED_RUNS, tokens: s.tokens ?? MAX_UNATTENDED_TOKENS };
}

/**
 * Saves the owner's limits keeping only what differs from the defaults, so a later default reaches whoever never
 * changed it.
 */
export function saveUnattendedLimits(store: Store, limits: { runs: number; tokens: number }) {
  const { runs: _runs, tokens: _tokens, ...rest } = store.settings.read("agent_limits");
  store.settings.write("agent_limits", {
    ...rest,
    ...(limits.runs !== MAX_UNATTENDED_RUNS ? { runs: limits.runs } : {}),
    ...(limits.tokens !== MAX_UNATTENDED_TOKENS ? { tokens: limits.tokens } : {}),
  });
}

/** One agent's own limits inside those, when the owner gave it any (0: none of that kind). */
export function agentLimits(store: Store, agentId: string): { runs: number; tokens: number } | undefined {
  const own = store.settings.read("agent_limits").agents?.[agentId];
  if (!own?.runs && !own?.tokens) return undefined;
  return { runs: own.runs ?? 0, tokens: own.tokens ?? 0 };
}
