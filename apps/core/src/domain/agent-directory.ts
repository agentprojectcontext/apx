import { type AgentListing, parentIn, reportsOf, teamHead } from "@apx/protocol";
import { type AgentRecord, publicAgent } from "./agents.ts";
import type { Store } from "./store.ts";

/**
 * Use the same team head for discovery and imported-chat routing: a marked agent with no parent in the team, else
 * inference among roots. A marked sub-team lead leads only its reports; explicit opt-outs never become heads.
 */
export function projectOrchestrator(team: AgentRecord[]) {
  return teamHead(team);
}

export function agentDirectory(store: Store): AgentListing[] {
  const agents = store.agents.list();
  const teams = Map.groupBy(
    agents.filter((a) => a.project_id),
    (a) => a.project_id,
  );
  const heads = new Map([...teams].map(([id, team]) => [id, projectOrchestrator(team)]));
  return agents.map((a) => {
    const team = a.project_id ? (teams.get(a.project_id) ?? []) : [];
    const head = a.project_id ? heads.get(a.project_id) : undefined;
    const parent = parentIn(team, a);
    return {
      ...publicAgent(a),
      scope: a.project_id ? "project" : "global",
      project_name: a.project_id ? (store.projects.get(a.project_id)?.name ?? null) : null,
      project_orchestrator: head ? { id: head.agent.id, name: head.agent.name, selection: head.selection } : null,
      is_orchestrator: head?.agent.id === a.id,
      reports_to: parent ? { id: parent.id, name: parent.name } : null,
      leads: reportsOf(team, a).map((r) => r.id),
    };
  });
}
