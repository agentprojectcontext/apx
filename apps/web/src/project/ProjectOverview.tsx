import { AgentAvatar, EmptyState, Icons, Spinner } from "@apx/ui";
import { useMemo } from "react";
import { shortWhen } from "../common/format.ts";
import { blobOf, inProject, isListed, isWorking, type ProjectEntry, threadAgent } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { standsAlone } from "../inbox/groupThreads.ts";
import { go } from "../shell/nav.ts";
import { KindTile, kindLabel, kindOf } from "../surfaces/artifactKind.tsx";
import { ProjectBoard } from "./ProjectBoard.tsx";
import { ProjectHelper } from "./ProjectHelper.tsx";
import { ProjectSideBlocks, useProjectMembers } from "./ProjectSide.tsx";

/** Overview: what runs now, the team, counts and the latest chats. All real data; nothing sampled. */
export function ProjectOverview({ project }: { project: ProjectEntry }) {
  const t = useT();
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const surfaces = useData((s) => s.surfaces);
  const pid = project.id;

  const chats = useMemo(
    () =>
      Object.values(threads)
        .filter((t) => (isListed(t) && inProject(t, pid)) || standsAlone(t, threads, pid))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [threads, pid],
  );
  const running = chats.filter((t) => isWorking(t.state) || t.state === "input-required");
  // The count matches the Agents tab's team and its project's: the global agents are listed, not counted.
  const { members } = useProjectMembers(project);
  const teamSize = members.filter((m) => m.from !== "everywhere").length;
  const unread = chats.reduce((n, t) => n + t.unread, 0);
  const apps = useMemo(
    // Pinned widgets live on the board above; this lists what is in Apps.
    () => Object.values(surfaces).filter((s) => s.in_apps && inProject(s, pid)),
    [surfaces, pid],
  );

  return (
    <div className="overview">
      <div className="overview__main">
        {!project.isDefault && <ProjectHelper key={pid} project={pid} />}
        <ProjectBoard projectId={pid} />
      </div>
      {/* Beside the widgets, always the same width: what the project has and what runs in it. */}
      <aside className="overview__side" aria-label={t("project.tab.overview")}>
        <div className="overview__stats">
          <Stat value={chats.length} label={t("overview.chats")} onClick={() => go.projectTab("chats")} />
          <Stat value={unread} label={t("overview.unread")} onClick={() => go.projectTab("chats")} />
          <Stat value={teamSize} label={t("overview.agents")} onClick={() => go.projectTab("team")} />
        </div>
        <section className="overview__block">
          <h2 className="overview__h">{t("overview.now")}</h2>
          {running.length ? (
            running.map((th) => {
              const agent = threadAgent(th, agents);
              return (
                <button
                  key={th.id}
                  type="button"
                  className="overview__run"
                  onClick={() => go.project(pid, "chats", th.id)}
                >
                  <AgentAvatar name={agent?.name ?? th.title} blob={blobOf(agent)} size={32} animated={false} />
                  <span className="overview__runtext">
                    <span className="overview__runtitle">{th.title}</span>
                    <span className="overview__runsub">
                      {agent?.name ?? t("common.agent")} ·{" "}
                      {th.state === "input-required"
                        ? t("running.waitingForYou")
                        : firstLine(th.preview) || t("thread.working")}
                    </span>
                  </span>
                  {isWorking(th.state) ? <Spinner size={14} /> : <Icons.Hand size={14} />}
                </button>
              );
            })
          ) : (
            <EmptyState variant="dashed">{t("overview.nothingRunning")}</EmptyState>
          )}
        </section>

        <ProjectSideBlocks project={project} />

        {apps.length > 0 && (
          <section className="overview__block">
            <h2 className="overview__h">{t("overview.appsOnly")}</h2>
            {apps.map((s) => (
              <button key={s.id} type="button" className="overview__row" onClick={() => go.app(s.id)}>
                <KindTile kind={kindOf(s)} size={20} />
                <span className="overview__rowname">{s.title}</span>
                <span className="overview__rowwhen">{kindLabel(kindOf(s), t)}</span>
              </button>
            ))}
          </section>
        )}

        <section className="overview__block">
          <h2 className="overview__h">
            {t("overview.recent")}
            {chats.length > 0 && (
              <button type="button" className="overview__link" onClick={() => go.projectTab("chats")}>
                {t("overview.seeAll")}
              </button>
            )}
          </h2>
          {chats.length ? (
            chats.slice(0, 5).map((th) => (
              <button
                key={th.id}
                type="button"
                className="overview__row"
                onClick={() => go.project(pid, "chats", th.id)}
              >
                <Icons.MessageCircle size={14} />
                <span className="overview__rowname">{th.title}</span>
                {th.unread > 0 && <span className="overview__unread">{th.unread}</span>}
                <span className="overview__rowwhen">{shortWhen(th.updated_at)}</span>
              </button>
            ))
          ) : (
            <EmptyState variant="dashed">{t("overview.noChats")}</EmptyState>
          )}
        </section>
      </aside>
    </div>
  );
}

function Stat({ value, label, onClick }: { value: number; label: string; onClick: () => void }) {
  return (
    <button type="button" className="overview__stat" onClick={onClick}>
      <span className="overview__statv">{value}</span>
      <span className="overview__statl">{label}</span>
    </button>
  );
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim()) ?? "").replace(/\*\*|`/g, "");
}
