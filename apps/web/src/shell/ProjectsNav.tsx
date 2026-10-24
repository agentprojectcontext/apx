import { IconButton, Icons, ProjectTile } from "@apx/ui";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  inInbox,
  inProject,
  isListed,
  isWorking,
  type ProjectEntry,
  projectEntries,
  projectInitial,
  projectTone,
} from "../data/identity.ts";
import { rememberSidebar, setPrefs, usePrefs, useSidebarRows } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { NewProjectDialog, ProjectSettings, UnregisterProjectDialog } from "../lazy.ts";
import { go, useNav } from "./nav.ts";
import { projectNavMenu } from "./ProjectNavActions.tsx";
import { SidebarNavRow } from "./SidebarNavRow.tsx";
import { SidebarOverflow, SidebarRowsGrip, SidebarSection } from "./SidebarSection.tsx";

/**
 * The Projects section: foldable as a whole, and past the rows the owner dragged it to the rest goes into a "N more"
 * popover.
 * The base space remains first, followed by the owner’s last opened or manually ordered projects.
 */
export function ProjectsNav({ rail }: { rail: boolean }) {
  const t = useT();
  const folded = usePrefs((s) => s.projectsFolded);
  const saved = usePrefs((s) => s.projectOrder);
  const view = useNav((s) => s.view);
  const projectId = useNav((s) => s.projectId);
  const projects = useData((s) => s.projects);
  const threads = useData((s) => s.threads);
  const [moreOpen, setMoreOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState<ProjectEntry>();
  const [removing, setRemoving] = useState<ProjectEntry>();
  // The rail has no section header to unfold with, so it always lists them.
  const hidden = folded && !rail;
  const routines = usePrefs((s) => s.inboxRoutines);
  const rows = useSidebarRows("projects");
  const { shown, rest, running, unread, ordered } = useMemo(() => {
    const entries = projectEntries(projects);
    const live = Object.values(threads).filter(isListed);
    const lastActive = new Map<string, string>();
    const running = new Set<string>();
    for (const p of entries)
      for (const th of live) {
        if (!inProject(th, p.id)) continue;
        if (isWorking(th.state)) running.add(p.id);
        if ((lastActive.get(p.id) ?? "") < th.updated_at) lastActive.set(p.id, th.updated_at);
      }
    // What the Inbox would count as unread, a routine's news included when it lists them.
    const unread = new Map<string, string[]>();
    for (const th of Object.values(threads)) {
      if (th.unread === 0 || !inInbox(th, routines)) continue;
      const pid = entries.find((p) => inProject(th, p.id))?.id ?? "";
      unread.set(pid, [...(unread.get(pid) ?? []), th.id]);
    }
    const rank = new Map(saved.map((id, index) => [id, index]));
    const ordered = [...entries].sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
        (lastActive.get(b.id) ?? "").localeCompare(lastActive.get(a.id) ?? ""),
    );
    // Folding a single leftover would save nothing.
    const cut = ordered.length > rows + 1 ? rows : ordered.length;
    return {
      shown: ordered.slice(0, cut),
      rest: ordered.slice(cut),
      ordered: ordered.map((p) => p.id),
      running,
      unread,
    };
  }, [projects, threads, saved, routines, rows]);
  // Read when a project opens, not when the list reorders after it. The page coming back on a project (a reload)
  // is not opening it.
  const inView = useRef<string[]>([]);
  inView.current = shown.map((p) => p.id);
  const open = view === "project" ? projectId : undefined;
  const lastOpen = useRef(open);
  useEffect(() => {
    if (open === lastOpen.current) return;
    lastOpen.current = open;
    if (open) rememberSidebar("projectOrder", open, inView.current);
  }, [open]);

  const item = (p: ProjectEntry, onPick?: () => void) => (
    <SidebarNavRow
      id={p.id}
      kind="project"
      order={ordered}
      locked={p.isDefault}
      onMove={(id, index) => {
        if (id === ordered[0]) return;
        const ids = ordered.filter((current) => current !== id);
        ids.splice(Math.max(1, index), 0, id);
        setPrefs({ projectOrder: ids });
      }}
      items={projectNavMenu(
        p,
        t,
        () => setSettings(p),
        () => setRemoving(p),
        () => setMoreOpen(false),
        unread.get(p.id),
      )}
      key={p.id}
      rail={rail && !onPick}
      icon={<ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} />}
      label={p.name}
      trailing={
        <>
          {p.isDefault && <Icons.Lock size={12} aria-label={t("nav.baseProject")} />}
          {running.has(p.id) ? (
            <span className="sidebar__running" title={t("common.running")} />
          ) : (
            unread.has(p.id) && <span className="sidebar__unread" title={t("inbox.unread")} />
          )}
        </>
      }
      active={view === "project" && projectId === p.id}
      onPick={() => {
        onPick?.();
        go.project(p.id);
      }}
    />
  );

  const add = (
    <IconButton
      size="sm"
      className="sidebar__add"
      label={t("nav.newProject")}
      icon={<Icons.Plus size={14} />}
      onClick={() => setAdding(true)}
    />
  );

  return (
    <>
      <SidebarSection
        rail={rail}
        title={t("nav.projects")}
        action={add}
        folded={folded}
        onToggle={() => {
          setMoreOpen(false);
          setPrefs({ projectsFolded: !folded });
        }}
      />
      {!hidden && shown.map((p) => item(p))}
      {!hidden && rest.length > 0 && (
        <SidebarOverflow
          rail={rail}
          title={t("nav.moreProjects", { n: rest.length })}
          label={t("nav.moreProjects", { n: rest.length })}
          count={rest.length}
          active={view === "project" && rest.some((p) => p.id === projectId)}
          open={moreOpen}
          onOpenChange={setMoreOpen}
        >
          {rest.map((p) => item(p, () => setMoreOpen(false)))}
        </SidebarOverflow>
      )}
      {!hidden && !rail && (
        <SidebarRowsGrip section="projects" total={shown.length + rest.length} title={t("nav.projects")} />
      )}
      <Suspense fallback={null}>
        {adding && <NewProjectDialog onClose={() => setAdding(false)} />}
        {settings && (
          <ProjectSettings project={settings} open onOpenChange={(open) => !open && setSettings(undefined)} />
        )}
        {removing && <UnregisterProjectDialog project={removing} onClose={() => setRemoving(undefined)} />}
      </Suspense>
    </>
  );
}
