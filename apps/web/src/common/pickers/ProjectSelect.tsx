import { ProjectTile, Select } from "@apx/ui";
import { DEFAULT_PID, projectEntries, projectInitial, projectTone } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";

/** Where something belongs: the base space (no project) or one of the projects, with its tile. */
export function ProjectSelect({
  value,
  onChange,
  label,
  size,
  className,
}: {
  /** A real project id, or undefined for the base space. */
  value: string | undefined;
  onChange: (projectId: string | undefined) => void;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  return (
    <Select
      label={label ?? t("pickers.project")}
      size={size ?? "md"}
      {...(className ? { className } : {})}
      value={value ?? DEFAULT_PID}
      options={projectEntries(projects).map((p) => ({
        value: p.id,
        label: p.name,
        icon: <ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} size={16} />,
      }))}
      onValueChange={(v) => onChange(v && v !== DEFAULT_PID ? v : undefined)}
    />
  );
}
