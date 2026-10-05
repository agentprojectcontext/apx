import { IconButton, Icons, ProjectTile } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import {
  inProject,
  isListed,
  isWorking,
  type ProjectEntry,
  projectEntries,
  projectInitial,
  projectTone,
} from "../data/identity.ts";
import { rememberSidebar, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ProjectSettings } from "../project/ProjectSettings.tsx";
import { NewProjectDialog } from "./NewProjectDialog.tsx";
import { go, useNav } from "./nav.ts";
import { projectNavMenu, UnregisterProjectDialog } from "./ProjectNavActions.tsx";
import { SidebarNavRow } from "./SidebarNavRow.tsx";
import { SidebarOverflow, SidebarSection } from "./SidebarSection.tsx";

/** Projects shown before the rest folds into "N more". */
const SHOWN = 5;

/**
 * The Projects section: foldable as a whole, and past SHOWN entries the rest goes into a "N more" popover.
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
  useEffect(() => {
    if (view === "project" && projectId) rememberSidebar("projectOrder", projectId);
  }, [view, projectId]);

  const { shown, rest, running, ordered } = useMemo(() => {
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
    const rank = new Map(saved.map((id, index) => [id, index]));
    const ordered = [...entries].sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
        (lastActive.get(b.id) ?? "").localeCompare(lastActive.get(a.id) ?? ""),
    );
    // Folding a single leftover would save nothing.
    const cut = ordered.length > SHOWN + 1 ? SHOWN : ordered.length;
    return {
      shown: ordered.slice(0, cut),
      rest: ordered.slice(cut),
      ordered: ordered.map((p) => p.id),
      running,
    };
  }, [projects, threads, saved]);

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
      )}
      key={p.id}
      rail={rail && !onPick}
      icon={<ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} />}
      label={p.name}
      trailing={
        <>
          {p.isDefault && <Icons.Lock size={12} aria-label={t("nav.baseProject")} />}
          {running.has(p.id) && <span className="sidebar__running" title={t("common.running")} />}
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
      {adding && <NewProjectDialog onClose={() => setAdding(false)} />}
      {settings && <ProjectSettings project={settings} open onOpenChange={(open) => !open && setSettings(undefined)} />}
      {removing && <UnregisterProjectDialog project={removing} onClose={() => setRemoving(undefined)} />}
    </>
  );
}
