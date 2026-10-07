import type { Agent } from "@apx/protocol";

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
