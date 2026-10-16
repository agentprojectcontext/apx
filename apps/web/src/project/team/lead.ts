import type { Agent } from "@apx/protocol";

// Who sits on top of the hierarchy, in order: an orchestrator, then a CEO, then any "lead".
const LEADS = [/orchestr|orquest/i, /\bceo\b|chief executive/i, /\blead\b/i];

/** One the owner unmarked as orchestrator is never guessed to be the head. */
const guessable = (a: Agent) => a.orchestrator !== false;

/** A team's top agent: the super-agent, else the one marked orchestrator, else one that looks like it, else none. */
export function teamLead(team: Agent[]): Agent | undefined {
  return (
    team.find((a) => a.kind === "secretary") ??
    team.find((a) => a.orchestrator) ??
    team.find((a) => guessable(a) && !a.parent && LEADS.some((re) => re.test(`${a.role} ${a.id}`))) ??
    LEADS.map((re) => team.find((a) => guessable(a) && re.test(`${a.role} ${a.id}`))).find(Boolean)
  );
}
