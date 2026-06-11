// Discord-style left rail. Logo on top (APX admin), then Base, then the
// rail-level MODULES (Voice/Deck/Code) that sit alongside Base, then the
// projects column, finally add + settings. The default workspace (id=0) is
// pinned first.
import { useLocation } from "react-router-dom";
import { Plus, Settings, Mic, Monitor, LayoutGrid, Terminal, Bot, type LucideIcon } from "lucide-react";
import { Logo } from "./Logo";
import { ProjectAvatar } from "./ProjectAvatar";
import { Tip } from "../ui/tip";
import { useProjects } from "../../hooks/useProjects";
import { t } from "../../i18n";
import { usePersonaName } from "../../hooks/usePersonaName";

interface Props {
  onSelect: (href: string) => void;
  onOpenRoby: () => void;
}

interface ModuleItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

// Rail-level modules: large surfaces (many views/menus) that deserve a
// top-level entry next to Base rather than living inside Settings.
function buildModules(): ModuleItem[] {
  return [
    { id: "voice",   label: t("nav.modules.voice"),   href: "/m/voice",   icon: Mic },
    { id: "desktop", label: t("nav.modules.desktop"), href: "/m/desktop", icon: Monitor },
    { id: "deck",  label: t("nav.modules.deck"),  href: "/m/deck",  icon: LayoutGrid },
    { id: "code",  label: t("nav.modules.code"),  href: "/m/code",  icon: Terminal },
  ];
}

export function ProjectSidebar({ onSelect, onOpenRoby }: Props) {
  const { projects, isLoading } = useProjects();
  const location = useLocation();
  const MODULES = buildModules();
  const persona = usePersonaName();

  const isActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(`${href}/`);
  const base = projects.find((p) => String(p.id) === "0");
  const rest = projects.filter((p) => String(p.id) !== "0");

  return (
    <aside className="flex h-full w-20 flex-col items-center gap-3 overflow-y-auto bg-transparent py-3">
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

      {base && (
        <ProjectAvatar
          label={t("base.title")}
          testId="project-avatar-0"
          title={t("base.subtitle")}
          active={isActive("/p/0")}
          isDefault
          icon={<img src="/modules/superagent.png" alt={t("base.title")} className="size-7 object-contain" draggable={false} />}
          onClick={() => onSelect("/p/0")}
        />
      )}

      {/* Modules — rail-level surfaces alongside Base. */}
      <div className="my-0.5 h-px w-8 rounded-full bg-border" />
      {MODULES.map((m) => (
        <ProjectAvatar
          key={m.id}
          label={m.label}
          testId={`module-avatar-${m.id}`}
          title={m.label}
          active={isActive(m.href)}
          icon={<m.icon size={18} />}
          onClick={() => onSelect(m.href)}
        />
      ))}

      {rest.length > 0 && <div className="my-0.5 h-px w-8 rounded-full bg-border" />}
      {rest.map((p) => {
        const label = p.name || p.path.split("/").pop() || String(p.id);
        const href = `/p/${p.id}`;
        return (
          <ProjectAvatar
            key={p.id}
            label={label}
            testId={`project-avatar-${p.id}`}
            title={`${label} — ${p.path}`}
            active={isActive(href)}
            onClick={() => onSelect(href)}
          />
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
      {/* Roby launcher — subtle (not a loud floating bubble), pinned under the
          gear so it doesn't overlap the chat composer. */}
      <Tip content={t("roby.talk", { persona })} side="right">
        <button
          type="button"
          onClick={onOpenRoby}
          data-testid="nav-roby"
          aria-label={t("roby.talk", { persona })}
          className="mt-1 flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted/30 text-muted-fg transition-colors hover:bg-accent hover:text-foreground"
        >
          <Bot size={18} />
        </button>
      </Tip>
    </aside>
  );
}

// Re-export for screens that still import projectKindLabel here.
export function projectKindLabel(kind?: string): string {
  switch (kind) {
    case "personal": return "Personal";
    case "company":  return "Company";
    case "app":      return "App";
    case "software": return "Software";
    case "default":  return "Default";
    case "other":    return "Other";
    default:         return t("nav.project");
  }
}
