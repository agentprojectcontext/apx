import { Icons, ProjectTile } from "@apx/ui";
import type { ReactNode } from "react";
import { projectInitial, projectTone } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";
import { SearchSelect } from "./pickers/SearchSelect.tsx";

/** `id` "all" shows everything; an option without an icon is a project and shows its tile. */
export type ScopeOption = { id: string; label: string; icon?: ReactNode };

/** Which project a list shows: everything, or one project picked from a list with a search box. */
export function ProjectSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange(id: string): void;
  options: ScopeOption[];
  className?: string;
}) {
  const t = useT();
  return (
    <SearchSelect
      label={label}
      searchPlaceholder={t("pickers.searchProject")}
      emptyLabel={t("pickers.noMatch")}
      size="sm"
      className={className ? `projselect ${className}` : "projselect"}
      value={value}
      onValueChange={(v) => onChange(v ?? "all")}
      options={options.map((o) => ({
        value: o.id,
        label: o.label,
        icon:
          o.icon ??
          (o.id === "all" ? (
            <Icons.Layers size={14} />
          ) : (
            <ProjectTile tone={projectTone(o.id)} initial={projectInitial(o.label)} size={16} />
          )),
      }))}
    />
  );
}
