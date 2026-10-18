import type { AgentListing } from "@apx/protocol";
import { type AgentRecord, publicAgent } from "./agents.ts";
import type { Store } from "./store.ts";

/** Use the same team head for discovery and imported-chat routing; explicit opt-outs never become heads. */
export function projectOrchestrator(team: AgentRecord[]):
  | {
      agent: AgentRecord;
      selection: "marked" | "role" | "sole_head";
    }
  | undefined {
  const marked = team.find((a) => a.orchestrator === true);
  if (marked) return { agent: marked, selection: "marked" };
  const heads = team.filter((a) => !a.parent || !team.some((b) => b.slug === a.parent));
  const role = heads.find(
    (a) => a.orchestrator !== false && /orchestr|orquest|lead|líder|lider/i.test(`${a.role} ${a.name}`),
  );
  if (role) return { agent: role, selection: "role" };
  const only = heads.length === 1 ? heads[0] : undefined;
  return only && only.orchestrator !== false ? { agent: only, selection: "sole_head" } : undefined;
}

export function agentDirectory(store: Store): AgentListing[] {
  const agents = store.agents.list();
  const teams = Map.groupBy(
    agents.filter((a) => a.project_id),
    (a) => a.project_id,
  );
  const heads = new Map([...teams].map(([id, team]) => [id, projectOrchestrator(team)]));
  return agents.map((a) => {
    const head = a.project_id ? heads.get(a.project_id) : undefined;
    return {
      ...publicAgent(a),
      scope: a.project_id ? "project" : "global",
      project_name: a.project_id ? (store.projects.get(a.project_id)?.name ?? null) : null,
      project_orchestrator: head ? { id: head.agent.id, name: head.agent.name, selection: head.selection } : null,
      is_orchestrator: head?.agent.id === a.id,
    };
  });
}
