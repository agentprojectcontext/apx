import type { Agent } from "@apx/protocol";

// Who sits on top of the hierarchy, in order: an orchestrator, then a CEO, then any "lead".
const LEADS = [/orchestr|orquest/i, /\bceo\b|chief executive/i, /\blead\b/i];

/** A team's top agent: the super-agent, else its orchestrator (one with no boss first), else none. */
export function teamLead(team: Agent[]): Agent | undefined {
  return (
    team.find((a) => a.kind === "secretary") ??
    team.find((a) => !a.parent && LEADS.some((re) => re.test(`${a.role} ${a.id}`))) ??
    LEADS.map((re) => team.find((a) => re.test(`${a.role} ${a.id}`))).find(Boolean)
  );
}
