// Discord-style left rail. Logo on top (APX admin), then Base together with the
// rail-level MODULES (Desktop/Code) as one group, then the projects column,
// finally add + settings. The default workspace (id=0) is pinned first.
// Voice and Deck used to live here too — they now live inside Settings.
//
// The projects column is the only flexible zone: top (logo/base/modules) and
// bottom (add/settings/docs/roby) stay pinned. Projects are listed newest-first
// and only as many as physically fit are shown inline — the rest collapse into
// a "+N" popover so the rail never overflows the viewport. The whole section can
// also be collapsed into a single folder button (state persisted per browser).
import { useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Settings, Monitor, Terminal, Bot, BookOpen, ChevronDown, Folders, type LucideIcon } from "lucide-react";
import { Logo } from "./Logo";
import { ProjectAvatar, projectTone } from "./ProjectAvatar";
import { Tip } from "../ui/tip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useNavCollapse } from "../common/TabNav";
import { useProjects } from "../../hooks/useProjects";
import { usePersonaName } from "../../hooks/usePersonaName";
import { STORAGE } from "../../constants";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { ProjectEntry } from "../../types/daemon";

interface Props {
  onSelect: (href: string) => void;
  onOpenRoby: () => void;
  onOpenAddProject?: () => void;
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
    { id: "desktop", label: t("nav.modules.desktop"), href: "/m/desktop", icon: Monitor },
    { id: "code",    label: t("nav.modules.code"),    href: "/m/code",    icon: Terminal },
  ];
}

// How many project avatars fit in the flexible list area. The list is `flex-1`,
// so its height is fixed by the surrounding chrome and does NOT depend on how
// many items we render — measuring it is therefore stable (no resize loop). The
// list also holds the always-present "Add" button (one slot) and, when there's
// overflow, the "+N" button (a second slot), so we reserve for those.
function useVisibleCount(
  listRef: React.RefObject<HTMLDivElement | null>,
  total: number,
  enabled: boolean,
): number {
  const [count, setCount] = useState(total);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !enabled) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      // clientHeight includes vertical padding; items lay out in the content box,
      // so subtract the padding we added to give the active ring breathing room.
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const h = el.clientHeight - padY;
      if (h <= 0) return;
      const gap = parseFloat(cs.rowGap) || 12;
      // A hidden, always-present probe gives an accurate item height even on the
      // first paint or when zero real items currently fit.
      const probe = el.querySelector<HTMLElement>("[data-rail-probe]");
      const per = (probe?.offsetHeight ?? 56) + gap;
      const slots = Math.max(0, Math.floor((h + gap) / per));
      const forItems = slots - 1; // reserve the Add button
      setCount(forItems >= total ? total : Math.max(0, forItems - 1)); // reserve "+N"
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [listRef, total, enabled]);
  return enabled ? Math.min(count, total) : total;
}

// Square rail button that opens a dropdown listing projects — used both for the
// "+N" overflow bucket and for the fully-collapsed folder.
function RailProjectMenu({
  projects,
  label,
  sublabel,
  icon,
  tooltip,
  header,
  active,
  testId,
  onSelect,
  isActive,
}: {
  projects: ProjectEntry[];
  label?: string;
  sublabel?: string;
  icon?: React.ReactNode;
  tooltip: string;
  header: string;
  active: boolean;
  testId: string;
  onSelect: (href: string) => void;
  isActive: (href: string) => boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid={testId}
        title={tooltip}
        aria-label={tooltip}
        className="group flex w-full cursor-pointer flex-col items-center gap-1"
      >
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-xl text-xs font-bold transition-all",
            "bg-muted/40 text-muted-fg hover:bg-accent hover:text-foreground",
            active && "ring-2 ring-foreground ring-offset-2 ring-offset-card",
          )}
        >
          {icon ?? label}
        </span>
        {sublabel && (
          <span className="block max-w-[3.6rem] truncate text-[9px] leading-tight text-muted-fg group-hover:text-foreground">
            {sublabel}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={8} className="max-h-[70vh] w-64">
        <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">{header}</div>
        {projects.map((p) => {
          const name = p.name || p.path.split("/").pop() || String(p.id);
          const href = `/p/${p.id}`;
          const { initials, idleClass } = projectTone(name);
          return (
            <DropdownMenuItem
              key={p.id}
              data-testid={`project-menu-item-${p.id}`}
              onClick={() => onSelect(href)}
              className={cn(isActive(href) && "bg-accent/60 text-foreground")}
            >
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold", idleClass)}>
                {initials}
              </span>
              <span className="truncate">{name}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectSidebar({ onSelect, onOpenRoby, onOpenAddProject }: Props) {
  const { projects, isLoading } = useProjects();
  const location = useLocation();
  const MODULES = buildModules();
  const persona = usePersonaName();
  const listRef = useRef<HTMLDivElement>(null);
  const { collapsed, toggle } = useNavCollapse(STORAGE.sidebarCollapsed + ".projects");

  const isActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(`${href}/`);
  const base = projects.find((p) => String(p.id) === "0");
  // Newest first — higher ids are more recently registered.
  const rest = projects
    .filter((p) => String(p.id) !== "0")
    .sort((a, b) => Number(b.id) - Number(a.id));

  const visibleCount = useVisibleCount(listRef, rest.length, !collapsed && rest.length > 0);
  const visible = rest.slice(0, visibleCount);
  const overflow = rest.slice(visibleCount);
  const overflowHasActive = overflow.some((p) => isActive(`/p/${p.id}`));

  return (
    <aside className="flex h-full w-20 flex-col items-center gap-3 overflow-hidden bg-transparent py-3">
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

      {/* Modules — rail-level surfaces grouped with Base (no divider). */}
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

      {/* Projects column — the only flexible zone. The measured list holds the
          projects, the "+N" overflow bucket and the Add button; it fills the
          remaining height so the bottom group (settings/docs/roby) stays pinned. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-3">
        {rest.length > 0 && (
          <>
            <div className="my-0.5 h-px w-8 rounded-full bg-border" />
            <Tip content={collapsed ? t("nav.expand_projects") : t("nav.collapse_projects")} side="right">
              <button
                type="button"
                onClick={toggle}
                data-testid="nav-toggle-projects"
                aria-label={collapsed ? t("nav.expand_projects") : t("nav.collapse_projects")}
                aria-expanded={!collapsed}
                className="flex h-5 w-8 cursor-pointer items-center justify-center rounded-md text-muted-fg transition-colors hover:bg-accent hover:text-foreground"
              >
                <ChevronDown className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")} />
              </button>
            </Tip>
          </>
        )}

        <div
          ref={listRef}
          className="flex min-h-0 w-full flex-1 flex-col items-center gap-3 overflow-hidden py-1.5"
        >
          {rest.length > 0 && collapsed && (
            <RailProjectMenu
              projects={rest}
              icon={<Folders size={18} />}
              sublabel={String(rest.length)}
              tooltip={t("nav.all_projects")}
              header={t("nav.all_projects")}
              active={rest.some((p) => isActive(`/p/${p.id}`))}
              testId="nav-projects-folder"
              onSelect={onSelect}
              isActive={isActive}
            />
          )}

          {rest.length > 0 && !collapsed && (
            <>
              {/* Hidden ruler — out of flow, measured to size the visible list
                  accurately regardless of how many items render. */}
              <div data-rail-probe aria-hidden className="invisible absolute w-full">
                <ProjectAvatar label="Ag" active={false} onClick={() => {}} />
              </div>
              {visible.map((p) => {
                const label = p.name || p.path.split("/").pop() || String(p.id);
                const href = `/p/${p.id}`;
                return (
                  <div key={p.id} data-rail-item className="w-full">
                    <ProjectAvatar
                      label={label}
                      testId={`project-avatar-${p.id}`}
                      title={`${label} — ${p.path}`}
                      active={isActive(href)}
                      onClick={() => onSelect(href)}
                    />
                  </div>
                );
              })}
              {overflow.length > 0 && (
                <RailProjectMenu
                  projects={overflow}
                  label={`+${overflow.length}`}
                  tooltip={t("nav.more_projects", { count: overflow.length })}
                  header={t("nav.more_projects", { count: overflow.length })}
                  active={overflowHasActive}
                  testId="nav-projects-overflow"
                  onSelect={onSelect}
                  isActive={isActive}
                />
              )}
            </>
          )}

          <ProjectAvatar
            label={t("nav.add_project")}
            isAdd
            testId="nav-add-project"
            icon={<Plus size={18} />}
            active={false}
            onClick={() => (onOpenAddProject ? onOpenAddProject() : onSelect("/?action=add-project"))}
            title={t("nav.add_project")}
          />
        </div>
      </div>

      <ProjectAvatar
        label={t("nav.settings")}
        isSettings
        testId="nav-settings"
        icon={<Settings size={16} />}
        active={location.pathname === "/settings" || location.pathname.startsWith("/settings/")}
        onClick={() => onSelect("/settings")}
        title={t("nav.settings")}
      />
      {/* Docs — opens the hosted documentation site in a new tab. */}
      <Tip content={t("settings_ui.documentation")} side="right">
        <a
          href="https://agentprojectcontext.github.io/apx/docs/"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="nav-docs"
          aria-label={t("settings_ui.documentation")}
          className="flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted/30 text-muted-fg transition-colors hover:bg-accent hover:text-foreground"
        >
          <BookOpen size={18} />
        </a>
      </Tip>
      {/* Roby launcher — subtle (not a loud floating bubble), pinned under the
          gear so it doesn't overlap the chat composer. */}
      <Tip content={t("superagent.talk", { persona })} side="right">
        <button
          type="button"
          onClick={onOpenRoby}
          data-testid="nav-roby"
          aria-label={t("superagent.talk", { persona })}
          className="flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted/30 text-muted-fg transition-colors hover:bg-accent hover:text-foreground"
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
    case "personal": return t("settings_ui.kind_personal");
    case "company":  return t("settings_ui.kind_company");
    case "app":      return t("settings_ui.kind_app");
    case "software": return t("settings_ui.kind_software");
    case "default":  return t("settings_ui.kind_default");
    case "other":    return t("settings_ui.kind_other");
    default:         return t("nav.project");
  }
}
