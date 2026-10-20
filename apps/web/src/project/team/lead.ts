import { type Agent, teamHead } from "@apx/protocol";

/**
 * A team's top agent: the super-agent, else the core's rule (a marked agent with no parent in the team, then one whose
 * role reads as a lead, then the only root), so the chart puts on top the agent the work goes to.
 */
export function teamLead(team: Agent[]): Agent | undefined {
  return team.find((a) => a.kind === "secretary") ?? teamHead(team)?.agent;
}
