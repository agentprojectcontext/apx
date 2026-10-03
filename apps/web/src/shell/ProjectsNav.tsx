import { Icons, NavItem, Popover, ProjectTile, SectionLabel } from "@apx/ui";
import { useMemo, useState } from "react";
import {
  inProject,
  isListed,
  isWorking,
  type ProjectEntry,
  projectEntries,
  projectInitial,
  projectTone,
} from "../data/identity.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { NewProjectDialog } from "./NewProjectDialog.tsx";
import { go, useNav } from "./nav.ts";

/** Projects shown before the rest folds into "N more". */
const SHOWN = 5;

/**
 * The Projects section: foldable as a whole, and past SHOWN entries the rest goes into a "N more" popover.
 * The base project, the open one, busy ones and the most recently active stay in view.
 */
export function ProjectsNav({ rail }: { rail: boolean }) {
  const t = useT();
  const folded = usePrefs((s) => s.projectsFolded);
  const view = useNav((s) => s.view);
  const projectId = useNav((s) => s.projectId);
  const projects = useData((s) => s.projects);
  const threads = useData((s) => s.threads);
  const [moreOpen, setMoreOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  // The rail has no section header to unfold with, so it always lists them.
  const hidden = folded && !rail;

  const { shown, rest, running } = useMemo(() => {
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
    const open = view === "project" ? projectId : undefined;
    const rank = (p: ProjectEntry) => (p.isDefault ? 3 : p.id === open ? 2 : running.has(p.id) ? 1 : 0);
    const ordered = [...entries].sort(
      (a, b) => rank(b) - rank(a) || (lastActive.get(b.id) ?? "").localeCompare(lastActive.get(a.id) ?? ""),
    );
    // Folding a single leftover would save nothing.
    const cut = ordered.length > SHOWN + 1 ? SHOWN : ordered.length;
    const shownIds = new Set(ordered.slice(0, cut).map((p) => p.id));
    return {
      shown: entries.filter((p) => shownIds.has(p.id)),
      rest: ordered.slice(cut).sort((a, b) => a.name.localeCompare(b.name)),
      running,
    };
  }, [projects, threads, view, projectId]);

  const item = (p: ProjectEntry, onPick?: () => void) => (
    <NavItem
      key={p.id}
      collapsed={rail && !onPick}
      icon={<ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} />}
      label={p.name}
      trailing={
        <>
          {p.isDefault && <Icons.Lock size={12} aria-label={t("nav.baseProject")} />}
          {running.has(p.id) && <span className="sidebar__running" title={t("common.running")} />}
        </>
      }
      active={view === "project" && projectId === p.id}
      onClick={() => {
        onPick?.();
        go.project(p.id);
      }}
    />
  );

  const add = (
    <button
      type="button"
      className="sidebar__add"
      aria-label={t("nav.newProject")}
      title={t("nav.newProject")}
      onClick={() => setAdding(true)}
    >
      <Icons.Plus size={14} />
    </button>
  );

  return (
    <>
      <hr className="sidebar__divider" />
      {rail ? (
        <div className="sidebar__railaction">{add}</div>
      ) : (
        <SectionLabel action={add}>
          <button
            type="button"
            className={folded ? "sidebar__toggle is-closed" : "sidebar__toggle"}
            aria-expanded={!folded}
            onClick={() => setPrefs({ projectsFolded: !folded })}
          >
            {t("nav.projects")}
            <Icons.ChevronDown size={12} className="sidebar__chev" />
          </button>
        </SectionLabel>
      )}
      {!hidden && shown.map((p) => item(p))}
      {!hidden && rest.length > 0 && (
        <Popover
          side="right"
          align="start"
          width={260}
          open={moreOpen}
          onOpenChange={setMoreOpen}
          label={t("nav.moreProjects", { n: rest.length })}
          trigger={
            <button
              type="button"
              className={rail ? "apx-nav apx-nav--collapsed sidebar__more" : "apx-nav sidebar__more"}
              aria-label={t("nav.moreProjects", { n: rest.length })}
              title={rail ? t("nav.moreProjects", { n: rest.length }) : undefined}
            >
              <span className="apx-nav__icon">
                <span className="sidebar__moretile">+{rest.length}</span>
              </span>
              {!rail && <span className="apx-nav__label">{t("nav.moreProjects", { n: rest.length })}</span>}
            </button>
          }
        >
          <div className="morelist__head">{t("nav.moreProjects", { n: rest.length })}</div>
          <div className="morelist">{rest.map((p) => item(p, () => setMoreOpen(false)))}</div>
        </Popover>
      )}
      {adding && <NewProjectDialog onClose={() => setAdding(false)} />}
    </>
  );
}
