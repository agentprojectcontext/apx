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
//
// Each project avatar carries a right-click menu: the rail shows one 40px tile
// per project and has nowhere to put a "⋯", so the verbs that don't fit (its
// config, its path, unregistering it) hang off the tile itself.
import { useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Settings, Monitor, Terminal, Bot, BookOpen, ChevronDown, Folders, MessagesSquare, Copy, SlidersHorizontal, Trash2, type LucideIcon } from "lucide-react";
import { Logo } from "./Logo";
import { ProjectAvatar, projectTone } from "./ProjectAvatar";
import { Tip } from "../ui/tip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { useToast } from "../Toast";
import { Projects } from "../../lib/api";
import { useNavCollapse } from "../common/TabNav";
import { useProjects } from "../../hooks/useProjects";
import { usePersonaName } from "../../hooks/usePersonaName";
import { STORAGE } from "../../constants";
import { cn } from "../../lib/cn";
import { switchProjectHref } from "../../lib/projectNav";
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

// A project you reach through the "+N" popover (or the collapsed folder) is one
// the rail failed to show you — so opening it pins it to the front, and it stays
// inline from then on. Order is per-browser; the list is capped so it can't grow
// forever with ids of projects that no longer exist.
const RAIL_ORDER_MAX = 32;

function useRailOrder(): { pinned: string[]; pin: (id: string) => void } {
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE.railOrder) || "[]");
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
  const pin = (id: string) =>
    setPinned((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RAIL_ORDER_MAX);
      try {
        localStorage.setItem(STORAGE.railOrder, JSON.stringify(next));
      } catch {
        /* private mode — the order is a convenience, not state we need */
      }
      return next;
    });
  return { pinned, pin };
}

// What a project is called on the rail: its name, else the last segment of its
// path, else its id — the same rule everywhere it is drawn.
function projectLabel(p: ProjectEntry): string {
  return p.name || p.path.split("/").pop() || String(p.id);
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
  onOpen,
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
  onOpen: (project: ProjectEntry) => void;
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
            active && "ring-2 ring-primary ring-offset-2 ring-offset-background",
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
          const name = projectLabel(p);
          const href = `/p/${p.id}`;
          const { initials, idleClass } = projectTone(name);
          return (
            <DropdownMenuItem
              key={p.id}
              data-testid={`project-menu-item-${p.id}`}
              onClick={() => onOpen(p)}
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
  const { projects, isLoading, mutate: mutateProjects } = useProjects();
  const location = useLocation();
  const toast = useToast();
  const MODULES = buildModules();
  const persona = usePersonaName();
  const listRef = useRef<HTMLDivElement>(null);
  const { collapsed, toggle } = useNavCollapse(STORAGE.sidebarCollapsed + ".projects");
  const { pinned, pin } = useRailOrder();
  // The one destructive verb on the rail never fires from the menu itself — it
  // parks the project here and the dialog below asks first.
  const [pendingRemove, setPendingRemove] = useState<ProjectEntry | null>(null);

  const isActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(`${href}/`);
  // Changing projects should change only the project: whatever tab you were
  // reading stays open on the other side when it exists there.
  const openProject = (project: Pick<ProjectEntry, "id" | "kind">) =>
    onSelect(switchProjectHref(location.pathname, project));
  // Reached through a menu, i.e. it wasn't on the rail — pull it to the front so
  // it is next time. Inline avatars never reorder: the rail would shuffle under
  // the cursor on every click.
  const openFromMenu = (project: ProjectEntry) => {
    pin(String(project.id));
    openProject(project);
  };
  const copyPath = async (project: ProjectEntry) => {
    try {
      await navigator.clipboard.writeText(project.path);
      toast.success(t("nav.path_copied"));
    } catch {
      toast.error(t("nav.copy_failed"));
    }
  };
  // Unregister, not delete: the project leaves APX's registry and every file on
  // disk stays. If you were reading the project you just removed, the rail
  // takes you home — its screen has nothing left to show.
  const runRemove = async () => {
    if (!pendingRemove) return;
    try {
      await Projects.remove(String(pendingRemove.id));
      toast.success(t("project.unregistered"));
      await mutateProjects();
      if (isActive(`/p/${pendingRemove.id}`)) onSelect("/");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const base = projects.find((p) => String(p.id) === "0");
  // Pinned first in the order they were pinned, then the rest newest-first —
  // higher ids are more recently registered.
  const rank = new Map(pinned.map((id, i) => [id, i]));
  const rest = projects
    .filter((p) => String(p.id) !== "0")
    .sort((a, b) => {
      const ra = rank.get(String(a.id)) ?? Infinity;
      const rb = rank.get(String(b.id)) ?? Infinity;
      return ra === rb ? Number(b.id) - Number(a.id) : ra - rb;
    });

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

      {/* The conversational way in. Sits above the project rail because it is
          the daily entry point — but the rail below it is untouched, and stays
          the structural axis. Drawn with the same avatar as Base and the
          modules: it used to be the one bordered white square in a rail of
          coloured tiles, which read as a different KIND of thing. */}
      <ProjectAvatar
        label={t("inbox.title")}
        sublabel={t("nav.modules.inbox_short")}
        tone="emerald"
        testId="nav-inbox"
        title={t("inbox.title")}
        active={isActive("/m/inbox")}
        icon={<MessagesSquare size={18} />}
        onClick={() => onSelect("/m/inbox")}
      />

      {isLoading && <div className="size-10 animate-pulse rounded-xl bg-muted" />}

      {base && (
        <ProjectAvatar
          label={t("base.title")}
          testId="project-avatar-0"
          title={t("base.subtitle")}
          active={isActive("/p/0")}
          isDefault
          icon={<img src="/modules/superagent.png" alt={t("base.title")} className="size-7 object-contain" draggable={false} />}
          onClick={() => openProject(base)}
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
              onOpen={openFromMenu}
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
              {visible.map((p) => (
                <ProjectRailItem
                  key={p.id}
                  project={p}
                  active={isActive(`/p/${p.id}`)}
                  onOpen={() => openProject(p)}
                  onOpenConfig={() => onSelect(`/p/${p.id}/config`)}
                  onCopyPath={() => copyPath(p)}
                  onRemove={() => setPendingRemove(p)}
                />
              ))}
              {overflow.length > 0 && (
                <RailProjectMenu
                  projects={overflow}
                  label={`+${overflow.length}`}
                  tooltip={t("nav.more_projects", { count: overflow.length })}
                  header={t("nav.more_projects", { count: overflow.length })}
                  active={overflowHasActive}
                  testId="nav-projects-overflow"
                  onOpen={openFromMenu}
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
          className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-fg transition-colors hover:bg-accent hover:text-foreground dark:bg-muted/60"
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
          className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-fg transition-colors hover:bg-accent hover:text-foreground dark:bg-muted/60"
        >
          <Bot size={18} />
        </button>
      </Tip>

      {/* Portalled: it lives here so the rail owns its own destructive flow,
          but it renders at the document root, outside the measured list. The
          path goes in the question — the tile only shows two initials, and the
          folder is what the answer is really about. */}
      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={runRemove}
        title={t("project.danger.unregister_confirm_title")}
        description={pendingRemove
          ? `${t("project.unregister_confirm", { label: projectLabel(pendingRemove) })} ${pendingRemove.path}`
          : ""}
        confirmLabel={t("admin.unregister")}
        testId="project-unregister-confirm"
      />
    </aside>
  );
}

// One rail avatar plus its right-click menu. Left click still just opens the
// project — the menu is for everything else, and the destructive item only
// arms the confirmation dialog.
function ProjectRailItem({
  project,
  active,
  onOpen,
  onOpenConfig,
  onCopyPath,
  onRemove,
}: {
  project: ProjectEntry;
  active: boolean;
  onOpen: () => void;
  onOpenConfig: () => void;
  onCopyPath: () => void;
  onRemove: () => void;
}) {
  const label = projectLabel(project);
  return (
    <ContextMenu>
      {/* data-rail-item stays on the trigger: it is what the layout measures
          and what the e2e specs locate. */}
      <ContextMenuTrigger data-rail-item className="w-full">
        <ProjectAvatar
          label={label}
          testId={`project-avatar-${project.id}`}
          title={`${label} — ${project.path}`}
          active={active}
          onClick={onOpen}
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" data-testid={`project-ctx-${project.id}`}>
        <div className="truncate px-1.5 py-1 text-xs font-medium text-muted-foreground">{label}</div>
        <ContextMenuItem onClick={onOpenConfig} data-testid={`project-ctx-config-${project.id}`}>
          <SlidersHorizontal /> {t("nav.project_settings")}
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyPath} data-testid={`project-ctx-copy-${project.id}`}>
          <Copy /> {t("nav.copy_path")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={onRemove}
          data-testid={`project-ctx-unregister-${project.id}`}
        >
          <Trash2 /> {t("admin.unregister")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
