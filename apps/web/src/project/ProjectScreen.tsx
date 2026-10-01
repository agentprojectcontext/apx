import { Badge, Button, EmptyState, IconButton, Icons, ProjectTile, Tabs } from "@apx/ui";
import { useEffect } from "react";
import { findProject, inProject, type ProjectEntry, projectInitial, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { NewChatMenu } from "../inbox/NewChatMenu.tsx";
import { ChatWorkspace } from "../shell/ChatWorkspace.tsx";
import type { Layout } from "../shell/layout.ts";
import { go, nav, PROJECT_TABS, type ProjectTab, useNav } from "../shell/nav.ts";
import { ProjectOverview } from "./ProjectOverview.tsx";
import { ProjectTeam } from "./ProjectTeam.tsx";
import { SoonPane } from "./SoonPane.tsx";

/** A project: header (tile, name, path, Nuevo chat) + underline tabs. SPEC §2.9. */
export function ProjectScreen({ layout }: { layout: Layout }) {
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
          title={ready ? "Proyecto no encontrado" : "Cargando proyecto…"}
          action={
            ready && (
              <Button size="sm" variant="secondary" onClick={() => go.inbox()}>
                Volver al Inbox
              </Button>
            )
          }
        >
          {ready ? "Puede que lo hayan quitado del core." : null}
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
                Proyecto base · no se puede borrar
              </Badge>
            )}
          </div>
          <div className="project__path">{project.path ?? "Espacio base · sin carpeta"}</div>
        </div>
        <NewChatMenu
          projectId={project.id}
          trigger={<Button leadingIcon={<Icons.SquarePen size={14} />}>Nuevo chat</Button>}
        />
        <IconButton
          variant="secondary"
          size="lg"
          label="Ajustes de los agentes"
          icon={<Icons.Settings size={16} />}
          onClick={() => go.config("agents")}
        />
      </div>
      <Tabs
        className="project__tabs"
        value={tab}
        onValueChange={(v) => go.projectTab(v as ProjectTab)}
        items={PROJECT_TABS.map((t) => ({ value: t.id, label: t.label }))}
      />
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
      return <ProjectTeam project={project} />;
    case "tasks":
      return (
        <SoonPane icon={<Icons.ListChecks />} title="Tareas del proyecto">
          Lo que cada agente tiene en curso, pendiente o bloqueado, con los compromisos que prometió cumplir.
        </SoonPane>
      );
    case "routines":
      return (
        <SoonPane icon={<Icons.Clock />} title="Rutinas">
          Trabajos programados: un pre-command, el agente si hace falta y un post-command.
        </SoonPane>
      );
    case "files":
      return (
        <SoonPane icon={<Icons.Folder />} title="Archivos">
          {project.path ? (
            <>
              El árbol de <code className="soon__code">{project.path}</code> y lo que los agentes crean en los chats.
            </>
          ) : (
            "Lo que los agentes crean en los chats de este espacio."
          )}
        </SoonPane>
      );
    case "memory":
      return (
        <SoonPane icon={<Icons.Brain />} title="Memoria">
          El cuaderno de cada agente, el índice local y lo que recuerdan de este proyecto.
        </SoonPane>
      );
    case "resources":
      return (
        <SoonPane icon={<Icons.Layers />} title="Recursos del proyecto">
          Skills, MCP, integraciones y variables propias, más las globales que hereda.
        </SoonPane>
      );
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
      .filter((t) => !t.parent_id && t.kind !== "a2a" && inProject(t, pid))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    if (latest?.id !== threadId) nav.set({ threadId: latest?.id });
  }, [pid, tab, threadId, threads]);
}
