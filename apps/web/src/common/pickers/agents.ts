import { type Agent, teamHead } from "@apx/protocol";

/** Project tasks use their team and the super-agent; the base space keeps its specialists. */
export function availableAgents(
  agents: readonly Agent[],
  projectId?: string,
  all = false,
  globalAgents: "all" | "secretary" = "all",
): Agent[] {
  return agents
    .filter((a) =>
      a.project_id ? all || a.project_id === projectId : globalAgents === "all" || a.kind === "secretary",
    )
    .sort(
      (a, b) =>
        Number(b.kind === "secretary") - Number(a.kind === "secretary") ||
        Number(Boolean(a.project_id)) - Number(Boolean(b.project_id)) ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Who a channel can be handed to: the super-agent and the head of each project's team. The rest of a team is reached
 * through its head, so a channel's list stays one name per project. `keep` stays listed even when it is none of
 * those, so a channel set some other way still shows who answers.
 */
export function channelAgents(agents: readonly Agent[], keep?: string): Agent[] {
  const teams = new Map<string, Agent[]>();
  for (const a of agents) if (a.project_id) teams.set(a.project_id, [...(teams.get(a.project_id) ?? []), a]);
  const heads = [...teams.values()].flatMap((team) => teamHead(team)?.agent ?? []);
  const listed = [...agents.filter((a) => !a.project_id && a.kind === "secretary"), ...heads];
  const kept = keep && !listed.some((a) => a.id === keep) ? agents.find((a) => a.id === keep) : undefined;
  return [...listed, ...(kept ? [kept] : [])].sort(
    (a, b) =>
      Number(b.kind === "secretary") - Number(a.kind === "secretary") ||
      Number(Boolean(a.project_id)) - Number(Boolean(b.project_id)) ||
      a.name.localeCompare(b.name),
  );
}
