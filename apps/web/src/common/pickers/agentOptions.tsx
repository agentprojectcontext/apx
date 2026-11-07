import { AgentAvatar, type SelectOption } from "@apx/ui";
import { useMemo } from "react";
import { baseName, blobOf } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { availableAgents, channelAgents } from "./agents.ts";

/**
 * The agents to pick from, grouped by project (global ones first). `projectId` keeps the global agents and that
 * project's; undefined lists every project's. `channel` lists the super-agent and each project's head instead, plus
 * `keep` as the agent already chosen.
 */
export function useAgentOptions(
  projectId?: string | undefined,
  all = false,
  globalAgents: "all" | "secretary" = "all",
  channel = false,
  keep?: string | undefined,
): SelectOption[] {
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  return useMemo(() => {
    const name = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;
    const list = channel
      ? channelAgents(Object.values(agents), keep)
      : availableAgents(Object.values(agents), projectId, all, globalAgents);
    return list.map((a) => ({
      value: a.id,
      label: a.name,
      icon: <AgentAvatar name={a.name} blob={blobOf(a)} size={16} animated={false} />,
      group: a.project_id ? name(a.project_id) : baseName(),
      ...(a.role ? { hint: a.role } : {}),
    }));
  }, [agents, projects, projectId, all, globalAgents, channel, keep]);
}
