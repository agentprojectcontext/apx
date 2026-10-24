import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { useAgentOptions } from "./agentOptions.tsx";
import { SearchSelect } from "./SearchSelect.tsx";

const NONE = "~none";

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
    <SearchSelect
      label={label ?? t("pickers.agent")}
      searchPlaceholder={t("pickers.searchAgent")}
      emptyLabel={t("pickers.noMatch")}
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
