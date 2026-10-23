// Who reports to whom inside one team, and who heads it: one rule for the core (discovery, routing) and the panel
// (the team chart), so the agent the owner sees on top is the one the work goes to.

export type TeamNode = {
  id: string;
  name: string;
  role?: string | undefined;
  slug?: string | undefined;
  parent?: string | undefined;
  orchestrator?: boolean | undefined;
};

export type HeadSelection = "marked" | "role" | "sole_head";

/** Roles that read as heading a team, when nobody is marked. */
const HEAD_ROLE = /orchestr|orquest|\bceo\b|chief executive|lead|líder|lider/i;

/** Whether `ref` names this agent: `parent:` may hold an agent's slug or its full id. */
export const names = (a: TeamNode, ref: string | undefined): boolean =>
  Boolean(ref) && (a.slug === ref || a.id === ref);

/** The agent of `team` that `a.parent` names, by slug or by full id; never itself. */
export function parentIn<T extends TeamNode>(team: readonly T[], a: TeamNode): T | undefined {
  if (!a.parent) return undefined;
  return team.find((b) => b.id !== a.id && names(b, a.parent));
}

/** Agents whose `parent:` names `a`, by slug or full id. */
export const reportsOf = <T extends TeamNode>(team: readonly T[], a: TeamNode): T[] =>
  team.filter((b) => b.id !== a.id && b.parent !== undefined && names(a, b.parent));

/**
 * The team's head. `orchestrator: true` means "leads the agents that report to it", so only a marked agent with no
 * parent in the team heads the whole of it; a marked sub-team lead does not. Unmarked, a root whose role reads as a
 * lead, else the only root. `orchestrator: false` is never guessed to be the head.
 */
export function teamHead<T extends TeamNode>(team: readonly T[]): { agent: T; selection: HeadSelection } | undefined {
  const roots = team.filter((a) => !parentIn(team, a));
  const marked = roots.find((a) => a.orchestrator === true);
  if (marked) return { agent: marked, selection: "marked" };
  const guessable = roots.filter((a) => a.orchestrator !== false);
  const role = guessable.find((a) => HEAD_ROLE.test(`${a.role ?? ""} ${a.name}`));
  if (role) return { agent: role, selection: "role" };
  const only = roots.length === 1 ? guessable[0] : undefined;
  return only ? { agent: only, selection: "sole_head" } : undefined;
}
