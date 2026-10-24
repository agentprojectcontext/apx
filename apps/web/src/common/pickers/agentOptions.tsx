import { AgentAvatar, type SelectOption } from "@apx/ui";
import { useMemo } from "react";
import { baseName, blobOf } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { availableAgents } from "./agents.ts";

/**
 * The agents to pick from, grouped by project (global ones first). `projectId` keeps the global agents and that
 * project's; undefined lists every project's.
 */
export function useAgentOptions(
  projectId?: string | undefined,
  all = false,
  globalAgents: "all" | "secretary" = "all",
): SelectOption[] {
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  return useMemo(() => {
    const name = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;
    return availableAgents(Object.values(agents), projectId, all, globalAgents).map((a) => ({
      value: a.id,
      label: a.name,
      icon: <AgentAvatar name={a.name} blob={blobOf(a)} size={16} animated={false} />,
      group: a.project_id ? name(a.project_id) : baseName(),
      ...(a.role ? { hint: a.role } : {}),
    }));
  }, [agents, projects, projectId, all, globalAgents]);
}
