import { AgentAvatar, Select, type SelectOption } from "@apx/ui";
import { useMemo } from "react";
import { baseName, blobOf } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { availableAgents } from "./agents.ts";

const NONE = "~none";

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

/**
 * Who does something: an agent, with its avatar, grouped by project. `none` adds a "nobody" choice; `all` lists every
 * project's agents (picking one from a project tells the caller that project through `onPick`).
 */
export function AgentSelect({
  value,
  onChange,
  projectId,
  all,
  globalAgents,
  none,
  label,
  size,
  className,
}: {
  value: string | undefined;
  onChange: (id: string | undefined, projectId: string | undefined) => void;
  projectId?: string | undefined;
  all?: boolean;
  globalAgents?: "all" | "secretary";
  /** The label of "nobody"; without it an agent must be picked. */
  none?: string;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const options = useAgentOptions(projectId, all, globalAgents);
  return (
    <Select
      label={label ?? t("pickers.agent")}
      size={size ?? "md"}
      {...(className ? { className } : {})}
      value={value ?? (none ? NONE : null)}
      placeholder={none ?? t("pickers.agent")}
      options={none ? [{ value: NONE, label: none }, ...options] : options}
      onValueChange={(v) => {
        const id = v && v !== NONE ? v : undefined;
        onChange(id, id ? agents[id]?.project_id : undefined);
      }}
    />
  );
}
