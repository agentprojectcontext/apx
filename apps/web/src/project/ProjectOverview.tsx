import "../styles/panel-parts.css";
import { useMemo } from "react";
import { inProject, isListed, type ProjectEntry } from "../data/identity.ts";
import { usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { standsAlone } from "../inbox/groupThreads.ts";
import { AgentsCard, RecentChatsCard, WaitingCard } from "./OverviewCards.tsx";
import { OverviewStats, useWaiting } from "./OverviewStats.tsx";
import { ProjectBoard } from "./ProjectBoard.tsx";
import { ProjectHelper } from "./ProjectHelper.tsx";
import { SubprojectsBlock } from "./SubprojectsBlock.tsx";

/**
 * Overview: the project's numbers and its widgets in the wide column; beside them, always in the same order, what to
 * review with an agent, what waits for the owner, the latest chats, the agents and the subprojects. All real data.
 */
export function ProjectOverview({ project }: { project: ProjectEntry }) {
  const t = useT();
  const threads = useData((s) => s.threads);
  const surfaces = useData((s) => s.surfaces);
  const pid = project.id;
  const chats = useMemo(
    () =>
      Object.values(threads)
        .filter((t) => (isListed(t) && inProject(t, pid)) || standsAlone(t, threads, pid))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [threads, pid],
  );
  const waiting = useWaiting(pid, chats);
  // A board given the whole width puts the side cards under it; with no widgets there is nothing to widen.
  const wideBoard = usePrefs((p) => p.boards[pid]?.wide) ?? false;
  const hasTiles = useMemo(
    () => Object.values(surfaces).some((s) => s.pinned && !s.page && inProject(s, pid)),
    [surfaces, pid],
  );

  return (
    <div className={`overview${wideBoard && hasTiles ? " is-wide" : ""}`}>
      <div className="overview__main">
        <OverviewStats project={project} chats={chats} waiting={waiting} />
        <ProjectBoard projectId={pid} />
      </div>
      <aside className="overview__side" aria-label={t("overview.summary")}>
        {!project.isDefault && <ProjectHelper key={pid} project={pid} />}
        <WaitingCard waiting={waiting} pid={pid} />
        <RecentChatsCard chats={chats} pid={pid} />
        <AgentsCard project={project} />
        <SubprojectsBlock project={project} />
      </aside>
    </div>
  );
}
