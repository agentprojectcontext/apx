import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, IconButton, Icons, Menu, ProjectTile, Tag } from "@apx/ui";
import { compactThread } from "../data/actions.ts";
import { blobOf, DEFAULT_PID, projectName, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { PanelSwitcher } from "../panel/PanelSwitcher.tsx";
import { go, useNav } from "../shell/nav.ts";

export function ChatHeader({ thread, agent, wide }: { thread: Thread; agent: Agent | undefined; wide: boolean }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const project = projects.find((p) => p.id === thread.project_id);
  const tools = useNav((s) => s.tools);
  const sub = thread.kind === "a2a" || thread.parent_id != null;
  const name = sub ? thread.title : (agent?.name ?? thread.title);

  return (
    <header className="chat__header">
      {sub && thread.parent_id && (
        <IconButton
          label={t("chat.back")}
          icon={<Icons.ArrowLeft size={16} />}
          onClick={() => thread.parent_id && go.thread(thread.parent_id)}
        />
      )}
      <AgentAvatar
        name={agent?.name ?? name}
        blob={blobOf(agent)}
        size={32}
        status={sub ? undefined : "online"}
        statusLabel={t("presence.online")}
      />
      <div className="chat__titles">
        <div className="chat__title">
          <span className="chat__name">{name}</span>
          {!sub && agent?.kind === "secretary" && <Tag kind="role">{t("agent.super")}</Tag>}
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
          {sub && <Tag>{t("thread.a2a")}</Tag>}
          {thread.channel && (
            <Tag>
              <Icons.Send size={11} /> {t("chat.viaChannel")}
            </Tag>
          )}
          {thread.kind === "code" && thread.cwd && (
            <span className="chat__code" title={thread.cwd}>
              <Icons.Code size={12} />
              <span className="chat__cwd">{thread.cwd}</span>
              <Tag>{t(`write.${thread.write ?? "ask"}`)}</Tag>
            </span>
          )}
        </div>
      </div>
      <div className="chat__tools">
        <IconButton
          label={tools ? t("chat.hideTools") : t("chat.showTools")}
          icon={<Icons.Wrench size={16} />}
          className={tools ? "chat__toolsbtn is-on" : "chat__toolsbtn"}
          onClick={go.toggleTools}
        />
        {!sub && (
          <Menu
            align="end"
            trigger={<IconButton label={t("chat.more")} icon={<Icons.Ellipsis size={16} />} />}
            items={[
              {
                label: t("chat.compact"),
                icon: <Icons.Layers size={14} />,
                onSelect: () => void compactThread(thread.id),
              },
            ]}
          />
        )}
        <span className="chat__toolsdiv" />
        <PanelSwitcher wide={wide} />
      </div>
    </header>
  );
}
