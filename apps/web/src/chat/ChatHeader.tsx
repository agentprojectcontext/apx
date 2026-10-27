import type { Agent, Thread, WritePolicy } from "@apx/protocol";
import { EngineIcon, IconButton, Icons, Menu, type MenuEntry, ProjectTile, Tag, Tooltip } from "@apx/ui";
import { Suspense } from "react";
import { useAgentHint } from "../common/AgentFace.tsx";
import { ChatProcesses } from "../common/ChatProcesses.tsx";
import { useEngineLabel } from "../common/useEngineLabel.ts";
import { compactThread } from "../data/actions.ts";
import { DEFAULT_PID, projectName, projectTone } from "../data/identity.ts";
import { isNewChat } from "../data/newChat.ts";
import { useData } from "../data/state.ts";
import { updateThread } from "../data/threadAdmin.ts";
import { useT } from "../i18n/index.ts";
import { ThreadAvatar } from "../inbox/ThreadAvatar.tsx";
import { PinMark } from "../inbox/ThreadRow.tsx";
import { threadMenu } from "../inbox/threadActions.tsx";
import { ChannelFace, TaskStatus } from "../lazy.ts";
import { PanelSwitcher } from "../panel/PanelSwitcher.tsx";
import { go, useNav } from "../shell/nav.ts";

const POLICIES: WritePolicy[] = ["ask", "auto", "read-only"];

/**
 * Whether the chat works in its project's folder and how freely: the same switch a code session has. Off, its agent
 * still runs commands there, asking as usual; on, its tools and outside engines follow the chosen policy.
 */
function folderMenu(thread: Thread, t: ReturnType<typeof useT>): MenuEntry {
  return {
    type: "submenu",
    label: t("chat.folder"),
    icon: <Icons.FolderCode size={14} />,
    items: [
      ...(thread.kind === "code"
        ? []
        : [
            {
              label: t("chat.folderOff"),
              checked: !thread.write,
              onSelect: () => void updateThread(thread.id, { write: null }),
            },
            { type: "separator" as const },
          ]),
      ...POLICIES.map((w) => ({
        label: t(`write.${w}`),
        checked: thread.write === w,
        onSelect: () => void updateThread(thread.id, { write: w }),
      })),
    ],
  };
}

export function ChatHeader({
  thread,
  agent,
  wide,
  compact = false,
}: {
  thread: Thread;
  agent: Agent | undefined;
  wide: boolean;
  /** Phone width: a back button returns to the chat list. */
  compact?: boolean;
}) {
  const t = useT();
  const agentHint = useAgentHint(agent, true);
  const projects = useData((s) => s.projects);
  const project = projects.find((p) => p.id === thread.project_id);
  const tools = useNav((s) => s.tools);
  const sub = thread.kind === "a2a" || thread.parent_id != null;
  // An engine session is the engine itself: its name and icon, not the agent that owns the run.
  const engine = useEngineLabel(thread.engine);
  const name = sub || thread.channel ? thread.title : (engine ?? agent?.name ?? thread.title);

  return (
    <header className={compact ? "chat__header chat__header--compact" : "chat__header"}>
      {compact && !(sub && thread.parent_id) && (
        <IconButton size="sm" label={t("chat.toList")} icon={<Icons.ArrowLeft size={14} />} onClick={go.showList} />
      )}
      {sub && thread.parent_id && (
        <IconButton
          label={t("chat.back")}
          size="sm"
          icon={<Icons.ArrowLeft size={14} />}
          onClick={() => thread.parent_id && go.thread(thread.parent_id)}
        />
      )}
      <ThreadAvatar thread={thread} agent={agent} size={32} slot={36} editable online={!sub} animated channelMark />
      <div className="chat__titles">
        <div className="chat__title">
          {agent && !engine && !thread.channel ? (
            <Tooltip content={agentHint}>
              <button type="button" className="chat__name chat__namebtn" onClick={() => go.agent(agent.id)}>
                {name}
              </button>
            </Tooltip>
          ) : (
            <span className="chat__name">{name}</span>
          )}
          {engine && <Tag kind="role">{t("engine.direct")}</Tag>}
          <ChatProcesses thread={thread.id} onOpen={go.processes} />
          {!sub && !engine && !thread.channel && agent && (agent.kind === "secretary" || agent.role) && (
            <Tag kind="role">{agent.kind === "secretary" ? t("agent.super") : agent.role}</Tag>
          )}
        </div>
        <div className="chat__crumb">
          <ProjectTile tone={projectTone(project?.id ?? DEFAULT_PID)} size={12} />
          <span>{projectName(projects, thread.project_id)}</span>
          {!sub && (
            <>
              <span className="chat__crumbsep">/</span>
              <span className="chat__crumbthread">
                {thread.pinned && <PinMark />}
                {thread.title}
              </span>
            </>
          )}
          {sub && <Tag>{t("thread.a2a")}</Tag>}
          {thread.task_id && (
            <Suspense fallback={null}>
              <TaskStatus id={thread.task_id} />
            </Suspense>
          )}
          {thread.task_id && (
            <button
              type="button"
              className="chat__task"
              title={t("tasks.fromTaskHint")}
              onClick={() => thread.task_id && go.task(thread.task_id)}
            >
              <Icons.ListChecks size={11} />
              {t("tasks.fromTask")}
            </button>
          )}
          {thread.channel && (
            <Suspense fallback={null}>
              <ChannelFace thread={thread} labelOnly />
            </Suspense>
          )}
          {thread.cwd && thread.write && (
            <span className="chat__code" title={thread.cwd}>
              {thread.engine || agent?.harness ? (
                <EngineIcon engine={thread.engine ?? agent?.harness ?? ""} size={12} />
              ) : (
                <Icons.Code size={12} />
              )}
              <span className="chat__cwd">{thread.cwd}</span>
              <Tag>{t(`write.${thread.write ?? "ask"}`)}</Tag>
            </span>
          )}
        </div>
      </div>
      <div className="chat__tools">
        <IconButton
          size="sm"
          label={tools ? t("chat.hideTools") : t("chat.showTools")}
          tooltip={t("chat.toolsHint")}
          icon={<Icons.Wrench size={14} />}
          className={tools ? "chat__toolsbtn is-on" : "chat__toolsbtn"}
          onClick={go.toggleTools}
        />
        {/* A new chat has nothing to rename, archive or compact until its first message makes it. */}
        {!sub && !isNewChat(thread.id) && (
          <Menu
            align="end"
            trigger={<IconButton size="sm" label={t("chat.more")} icon={<Icons.Ellipsis size={14} />} />}
            items={threadMenu(thread, {
              t,
              agent,
              extra: [
                ...(project?.path && project.present && ["loose", "agent", "code"].includes(thread.kind)
                  ? [folderMenu(thread, t)]
                  : []),
                {
                  label: t("chat.compact"),
                  icon: <Icons.Layers size={14} />,
                  onSelect: () => void compactThread(thread.id),
                },
              ],
            })}
          />
        )}
        <span className="chat__toolsdiv" />
        {/* Usage opens from the composer's context chip; read-only chats have no composer, so it stays here. */}
        <PanelSwitcher wide={wide} skipUsage={!sub} />
      </div>
    </header>
  );
}
