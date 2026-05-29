// Discord-style left rail. Logo on top (APX admin), then the projects column,
// finally add + settings. The default workspace (id=0) is a normal project in
// the column and is always first — `useProjects()` already sorts it that way.
import { Fragment } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Settings } from "lucide-react";
import { Logo } from "./Logo";
import { ProjectAvatar } from "./ProjectAvatar";
import { Tip } from "../ui/tip";
import { useProjects } from "../../hooks/useProjects";
import { t } from "../../i18n";

interface Props {
  onSelect: (href: string) => void;
}

export function ProjectSidebar({ onSelect }: Props) {
  const { projects, isLoading } = useProjects();
  const location = useLocation();

  return (
    <aside className="flex h-full w-20 flex-col items-center gap-3 bg-transparent py-3">
      <Tip content={t("nav.apx_admin")} side="right">
        <button
          type="button"
          onClick={() => onSelect("/")}
          data-testid="nav-home"
          className="mb-2 cursor-pointer"
        >
          <Logo size={36} />
        </button>
      </Tip>

      {isLoading && <div className="size-10 animate-pulse rounded-xl bg-muted" />}

      {projects.map((p) => {
        const isDefault = String(p.id) === "0";
        const label = isDefault ? "Base" : (p.name || p.path.split("/").pop() || String(p.id));
        const href = `/p/${p.id}`;
        const active = location.pathname === href || location.pathname.startsWith(`${href}/`);
        return (
          <Fragment key={p.id}>
            <ProjectAvatar
              label={label}
              testId={`project-avatar-${p.id}`}
              title={isDefault ? `Base · espacio general (no se puede borrar)` : `${label} — ${p.path}`}
              active={active}
              isDefault={isDefault}
              icon={isDefault ? <img src="/modules/superagent.png" alt="Base" className="size-7 object-contain" draggable={false} /> : undefined}
              onClick={() => onSelect(href)}
            />
            {isDefault && <div className="my-0.5 h-px w-8 rounded-full bg-border" />}
          </Fragment>
        );
      })}

      <ProjectAvatar
        label="Add"
        isAdd
        testId="nav-add-project"
        icon={<Plus size={18} />}
        active={false}
        onClick={() => onSelect("/?action=add-project")}
        title={t("nav.add_project")}
      />

      <div className="flex-1" />
      <ProjectAvatar
        label="Settings"
        isSettings
        testId="nav-settings"
        icon={<Settings size={16} />}
        active={location.pathname === "/settings" || location.pathname.startsWith("/settings/")}
        onClick={() => onSelect("/settings")}
        title={t("nav.settings")}
      />
    </aside>
  );
}

// Re-export for screens that still import projectKindLabel here.
export function projectKindLabel(kind?: string): string {
  switch (kind) {
    case "personal": return "Personal";
    case "company":  return "Empresa";
    case "app":      return "App";
    case "software": return "Software";
    case "default":  return "Default";
    case "other":    return "Otro";
    default:         return "Proyecto";
  }
}
