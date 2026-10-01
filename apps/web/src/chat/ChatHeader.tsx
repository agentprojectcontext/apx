import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, IconButton, Icons, ProjectTile, Tag } from "@apx/ui";
import { blobOf, DEFAULT_PID, projectName, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { PanelSwitcher } from "../panel/PanelSwitcher.tsx";
import { go, useNav } from "../shell/nav.ts";

export function ChatHeader({ thread, agent, wide }: { thread: Thread; agent: Agent | undefined; wide: boolean }) {
  const projects = useData((s) => s.projects);
  const project = projects.find((p) => p.id === thread.project_id);
  const tools = useNav((s) => s.tools);
  const sub = thread.kind === "a2a" || thread.parent_id != null;
  const name = sub ? thread.title : (agent?.name ?? thread.title);

  return (
    <header className="chat__header">
      {sub && thread.parent_id && (
        <IconButton
          label="Volver al chat"
          icon={<Icons.ArrowLeft size={16} />}
          onClick={() => thread.parent_id && go.thread(thread.parent_id)}
        />
      )}
      <AgentAvatar name={agent?.name ?? name} blob={blobOf(agent)} size={32} status={sub ? undefined : "online"} />
      <div className="chat__titles">
        <div className="chat__title">
          <span className="chat__name">{name}</span>
          {!sub && agent?.kind === "secretary" && <Tag kind="role">Super-agente</Tag>}
          {!sub && agent && agent.kind !== "secretary" && agent.role && <Tag kind="role">{agent.role}</Tag>}
        </div>
        <div className="chat__crumb">
          <ProjectTile tone={projectTone(project?.id ?? DEFAULT_PID)} size={12} />
          <span>{projectName(projects, thread.project_id)}</span>
          {!sub && (
            <>
              <span className="chat__crumbsep">/</span>
              <span className="chat__crumbthread">{thread.title}</span>
            </>
          )}
          {sub && <Tag>Agente ↔ agente</Tag>}
        </div>
      </div>
      <div className="chat__tools">
        <IconButton
          label={tools ? "Ocultar herramientas" : "Mostrar herramientas"}
          icon={<Icons.Wrench size={16} />}
          className={tools ? "chat__toolsbtn is-on" : "chat__toolsbtn"}
          onClick={go.toggleTools}
        />
        <span className="chat__toolsdiv" />
        <PanelSwitcher wide={wide} />
      </div>
    </header>
  );
}
