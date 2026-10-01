import { Badge, Button, EmptyState, IconButton, Icons, ProjectTile, Tabs } from "@apx/ui";
import { useEffect } from "react";
import { findProject, inProject, isListed, type ProjectEntry, projectInitial, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { NewChatMenu } from "../inbox/NewChatMenu.tsx";
import { ChatWorkspace } from "../shell/ChatWorkspace.tsx";
import type { Layout } from "../shell/layout.ts";
import { go, nav, PROJECT_TABS, type ProjectTab, useNav } from "../shell/nav.ts";
import { TasksBoard } from "../tasks/TasksBoard.tsx";
import { ProjectMemory } from "./ProjectMemory.tsx";
import { ProjectOverview } from "./ProjectOverview.tsx";
import { ProjectResources } from "./ProjectResources.tsx";
import { ProjectTeam } from "./ProjectTeam.tsx";
import { SoonPane } from "./SoonPane.tsx";

/** A project: header (tile, name, path, New chat) + underline tabs. SPEC §2.9. */
export function ProjectScreen({ layout }: { layout: Layout }) {
  const t = useT();
  const pid = useNav((s) => s.projectId);
  const tab = useNav((s) => s.projectTab);
  const projects = useData((s) => s.projects);
  const ready = useData((s) => s.ready);
  const project = findProject(projects, pid);
  useKeepThreadInProject(project?.id, tab);

  if (!project) {
    return (
      <section className="project project--missing">
        <EmptyState
          size="lg"
          icon={<Icons.Folder />}
          title={ready ? t("project.notFound") : t("project.loading")}
          action={
            ready && (
              <Button size="sm" variant="secondary" onClick={() => go.inbox()}>
                {t("common.backToInbox")}
              </Button>
            )
          }
        >
          {ready ? t("project.removed") : null}
        </EmptyState>
      </section>
    );
  }
  return (
    <section className="project" aria-label={project.name}>
      <ProjectHeader project={project} tab={tab} />
      <div className="project__body">
        <TabBody project={project} tab={tab} layout={layout} />
      </div>
    </section>
  );
}

function ProjectHeader({ project, tab }: { project: ProjectEntry; tab: ProjectTab }) {
  const t = useT();
  return (
    <header className="project__head">
      <div className="project__titlerow">
        <ProjectTile tone={projectTone(project.id)} initial={projectInitial(project.name)} size={36} />
        <div className="project__titles">
          <div className="project__name">
            <h1>{project.name}</h1>
            {project.isDefault && (
              <Badge>
                <Icons.Lock size={12} />
                {t("project.baseBadge")}
              </Badge>
            )}
          </div>
          <div className="project__path">{project.path ?? t("project.basePath")}</div>
        </div>
        <NewChatMenu
          projectId={project.id}
          trigger={<Button leadingIcon={<Icons.SquarePen size={14} />}>{t("chat.new")}</Button>}
        />
        <IconButton
          variant="secondary"
          size="lg"
          label={t("project.agentSettings")}
          icon={<Icons.Settings size={16} />}
          onClick={() => go.config("agents")}
        />
      </div>
      <Tabs
        className="project__tabs"
        value={tab}
        onValueChange={(v) => go.projectTab(v as ProjectTab)}
        items={PROJECT_TABS.map((x) => ({ value: x.id, label: t(x.label) }))}
      />
    </header>
  );
}

function TabBody({ project, tab, layout }: { project: ProjectEntry; tab: ProjectTab; layout: Layout }) {
  const t = useT();
  switch (tab) {
    case "overview":
      return <ProjectOverview project={project} />;
    case "chats":
      return <ChatWorkspace layout={layout} />;
    case "team":
      return <ProjectTeam project={project} />;
    case "tasks":
      return <TasksBoard projectId={project.id} />;
    case "routines":
      return (
        <SoonPane icon={<Icons.Clock />} title={t("project.tab.routines")}>
          {t("project.routines.body")}
        </SoonPane>
      );
    case "files":
      return (
        <SoonPane icon={<Icons.Folder />} title={t("project.tab.files")}>
          {project.path ? (
            <>
              {t("project.files.treeBefore")}
              <code className="soon__code">{project.path}</code>
              {t("project.files.treeAfter")}
            </>
          ) : (
            t("project.files.base")
          )}
        </SoonPane>
      );
    case "memory":
      return <ProjectMemory project={project} />;
    case "resources":
      return <ProjectResources project={project} />;
  }
}

/** Entering Chats: if the open chat belongs elsewhere, show this project's latest one (or none). */
function useKeepThreadInProject(pid: string | undefined, tab: ProjectTab) {
  const threads = useData((s) => s.threads);
  const threadId = useNav((s) => s.threadId);
  useEffect(() => {
    if (!pid || tab !== "chats") return;
    const current = threadId ? threads[threadId] : undefined;
    if (current && (inProject(current, pid) || current.parent_id)) return;
    const latest = Object.values(threads)
      .filter((t) => isListed(t) && inProject(t, pid))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    if (latest?.id !== threadId) nav.set({ threadId: latest?.id });
  }, [pid, tab, threadId, threads]);
}
