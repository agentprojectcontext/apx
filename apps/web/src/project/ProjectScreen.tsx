import "../styles/screens.css";
import { Badge, Button, EmptyState, IconButton, Icons, ProjectTile, Tabs } from "@apx/ui";
import { useEffect, useState } from "react";
import { loadProjectThreads } from "../data/actions.ts";
import {
  findProject,
  inProject,
  isListed,
  type ProjectEntry,
  projectInitial,
  projectTone,
  realProjectId,
} from "../data/identity.ts";
import { parseNewChat } from "../data/newChat.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { NewChatMenu } from "../inbox/NewChatMenu.tsx";
import { ResourcesView } from "../resources/ResourcesView.tsx";
import { RoutinesPane } from "../routines/RoutinesPane.tsx";
import { ChatWorkspace } from "../shell/ChatWorkspace.tsx";
import type { Layout } from "../shell/layout.ts";
import { go, nav, PROJECT_TABS, type ProjectTab, useNav } from "../shell/nav.ts";
import { ProjectTasks } from "../tasks/TasksList.tsx";
import { ProjectFiles } from "./files/ProjectFiles.tsx";
import { ProjectArtifacts } from "./ProjectArtifacts.tsx";
import { ProjectMemory } from "./ProjectMemory.tsx";
import { ProjectOverview } from "./ProjectOverview.tsx";
import { ProjectSettings } from "./ProjectSettings.tsx";
import { ProjectAgents } from "./ProjectTeam.tsx";
import { kindIcon, kindLabel } from "./projectKind.ts";
import { useProjectCounts } from "./useProjectCounts.ts";

/** A project: header (tile, name, path, New chat) + underline tabs. SPEC §2.9. */
export function ProjectScreen({ layout }: { layout: Layout }) {
  const t = useT();
  const pid = useNav((s) => s.projectId);
  const tab = useNav((s) => s.projectTab);
  const projects = useData((s) => s.projects);
  const ready = useData((s) => s.ready);
  const project = findProject(projects, pid);
  useKeepThreadInProject(project?.id, tab);
  const realId = project && !project.isDefault ? realProjectId(project.id) : undefined;
  useEffect(() => {
    if (realId) void loadProjectThreads(realId);
  }, [realId]);

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
  const counts = useProjectCounts(project.id);
  const [settings, setSettings] = useState(false);
  const KindIcon = kindIcon(project.kind);
  return (
    <header className="project__head">
      <div className="project__titlerow">
        <ProjectTile tone={projectTone(project.id)} initial={projectInitial(project.name)} size={36} />
        <div className="project__titles">
          <div className="project__name">
            <h1>{project.name}</h1>
            <button
              type="button"
              className="project__kind"
              title={t("project.kind.change")}
              onClick={() => setSettings(true)}
            >
              <Badge>
                <KindIcon size={12} />
                {kindLabel(t, project.kind)}
              </Badge>
            </button>
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
          label={t("project.settings")}
          icon={<Icons.Settings size={16} />}
          onClick={() => setSettings(true)}
        />
      </div>
      <Tabs
        className="project__tabs"
        value={tab}
        onValueChange={(v) => go.projectTab(v as ProjectTab)}
        items={PROJECT_TABS.map((x) => ({
          value: x.id,
          label: t(x.label),
          count: counts[x.id],
        }))}
      />
      <ProjectSettings project={project} open={settings} onOpenChange={setSettings} />
    </header>
  );
}

function TabBody({ project, tab, layout }: { project: ProjectEntry; tab: ProjectTab; layout: Layout }) {
  switch (tab) {
    case "overview":
      return <ProjectOverview project={project} />;
    case "chats":
      return <ChatWorkspace layout={layout} />;
    case "team":
      return <ProjectAgents project={project} />;
    case "tasks":
      return <ProjectTasks projectId={project.id} />;
    case "routines":
      return <RoutinesPane projectId={project.id} />;
    case "artifacts":
      return <ProjectArtifacts key={project.id} project={project} />;
    case "files":
      return <ProjectFiles key={project.id} project={project} />;
    case "memory":
      return <ProjectMemory project={project} />;
    case "resources":
      // Keyed: what was being added in one project never opens in the next.
      return <ResourcesView key={project.id} project={project} />;
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
    // A new chat is not a thread yet: it stays while it is this project's.
    const draft = parseNewChat(threadId);
    if (draft && inProject({ project_id: draft.project }, pid)) return;
    const latest = Object.values(threads)
      .filter((t) => isListed(t) && inProject(t, pid))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    if (latest?.id !== threadId) nav.set({ threadId: latest?.id });
  }, [pid, tab, threadId, threads]);
}
