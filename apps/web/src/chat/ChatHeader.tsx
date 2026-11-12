import type { Agent, Thread, WritePolicy } from "@apx/protocol";
import { Button, EngineIcon, IconButton, Icons, Menu, type MenuEntry, Tag, Tooltip } from "@apx/ui";
import { Suspense } from "react";
import { roomWord } from "../channels/kinds.ts";
import { useAgentHint } from "../common/AgentFace.tsx";
import { ChatProcesses } from "../common/ChatProcesses.tsx";
import { namedTitle } from "../common/mentionNames.ts";
import { useEngineLabel } from "../common/useEngineLabel.ts";
import { compactThread } from "../data/actions.ts";
import { useChannels } from "../data/channels.ts";
import { effortLabel, modelOf, splitRef, useModels } from "../data/models.ts";
import { isNewChat } from "../data/newChat.ts";
import { useData } from "../data/state.ts";
import { updateThread } from "../data/threadAdmin.ts";
import { useT } from "../i18n/index.ts";
import { ProjectBadge } from "../inbox/ProjectBadge.tsx";
import { ThreadAvatar } from "../inbox/ThreadAvatar.tsx";
import { PinMark } from "../inbox/ThreadRow.tsx";
import { threadMenu } from "../inbox/threadActions.tsx";
import { useThreadChannel } from "../inbox/useThreadChannel.ts";
import { ChannelFace, TaskCrumb, TaskStateButton } from "../lazy.ts";
import { PanelSwitcher } from "../panel/PanelSwitcher.tsx";
import { go, useNav } from "../shell/nav.ts";
import { toggleRoomCard, useRoomCard } from "./roomCard.ts";

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
  task,
}: {
  thread: Thread;
  agent: Agent | undefined;
  wide: boolean;
  /** A task's conversation: the task's title (its chat keeps the one it was created with). */
  task?: string;
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
  const agents = useData((s) => s.agents);
  const name = thread.channel
    ? thread.title
    : sub
      ? namedTitle(thread.title, agents, thread.agent_ids[0])
      : (engine ?? agent?.name ?? thread.title);
  const catalog = useModels((s) => s.catalog);
  // A group's or room's chat (a channel chat with nobody behind it) opens its card from here.
  const room = Boolean(thread.channel && !thread.channel.person_id);
  const roomChannel = useChannels((s) => s.channels.find((c) => c.id === thread.channel?.id));
  const roomOpen = useRoomCard();
  const channelKind = useThreadChannel(thread);
  const requestedRef = thread.model_choice?.model;
  const requested = requestedRef ? splitRef(requestedRef) : undefined;
  const requestedName = requestedRef && modelOf(requestedRef, catalog)?.name;

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
      <ThreadAvatar thread={thread} agent={agent} size={28} slot={32} editable online={!sub} animated />
      <div className="chat__titles">
        {/* The chat first, with its project; under it who answers there. */}
        <div className="chat__title">
          <span className="chat__name">
            {thread.pinned && <PinMark />}
            {sub || thread.channel || engine ? name : (task ?? thread.title)}
          </span>
          {project && <ProjectBadge id={project.id} name={project.name} channel={channelKind} />}
          <ChatProcesses thread={thread.id} onOpen={go.processes} />
        </div>
        <div className={thread.task_id || task !== undefined ? "chat__crumb is-task" : "chat__crumb"}>
          {thread.task_id && (
            <Suspense fallback={null}>
              <TaskCrumb thread={thread} taskId={thread.task_id} />
            </Suspense>
          )}
          {task !== undefined && <span>{t("tasks.header.task")}</span>}
          {agent && !engine && !thread.channel && !sub && !thread.task_id && (
            <Tooltip content={agentHint}>
              <button type="button" className="chat__agentbtn" onClick={() => go.agent(agent.id)}>
                {agent.kind === "secretary"
                  ? t("chat.headerSuper", { name: agent.name })
                  : agent.role
                    ? `${agent.name} · ${agent.role}`
                    : agent.name}
              </button>
            </Tooltip>
          )}
          {engine && <span>{t("chat.headerEngine", { engine })}</span>}
          {sub && <Tag>{t("thread.a2a")}</Tag>}
          {thread.flow && (
            <button
              type="button"
              className="chat__task"
              title={t("flows.fromFlowHint")}
              onClick={() => go.flows(thread.project_id, thread.flow?.id)}
            >
              <Icons.GitBranch size={11} />
              {t("flows.fromFlow")}
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
        {engine && (
          <div className="chat__crumb chat__modelrequest">
            <span>{t("chat.modelRequested")}</span>
            {requested?.model ? (
              requestedName ? (
                <span>{requestedName}</span>
              ) : (
                <code>{requested.model}</code>
              )
            ) : (
              <span>{t("chat.modelEngineDefault", { engine })}</span>
            )}
            {requested?.effort && <span>· {effortLabel(requested.effort)}</span>}
          </div>
        )}
      </div>
      <div className="chat__tools">
        {thread.task_id && (
          <Suspense fallback={null}>
            <TaskStateButton taskId={thread.task_id} />
          </Suspense>
        )}
        {room &&
          roomChannel &&
          // On a phone the pill is its icon alone: the chat's name needs the room.
          (compact ? (
            <IconButton
              size="sm"
              variant="secondary"
              className={roomOpen ? "chat__roompill is-on" : "chat__roompill"}
              icon={<Icons.Users size={14} />}
              label={t(roomWord(roomChannel))}
              tooltip={t(roomOpen ? "chat.roomCardClose" : "chat.roomCardOpen")}
              active={roomOpen}
              onClick={toggleRoomCard}
            />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className={roomOpen ? "chat__roompill is-on" : "chat__roompill"}
              leadingIcon={<Icons.Users size={14} />}
              aria-pressed={roomOpen}
              title={t(roomOpen ? "chat.roomCardClose" : "chat.roomCardOpen")}
              onClick={toggleRoomCard}
            >
              {t(roomWord(roomChannel))}
            </Button>
          ))}
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
                  label: t("chat.showTools"),
                  icon: <Icons.Wrench size={14} />,
                  checked: tools,
                  keepOpen: true,
                  onSelect: go.toggleTools,
                },
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
