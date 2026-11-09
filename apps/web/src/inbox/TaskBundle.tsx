import "../styles/inbox-parts.css";
import type { Thread } from "@apx/protocol";
import { ContextMenu, ConversationRow, IconButton, Icons, Menu, type MenuEntry, Spinner } from "@apx/ui";
import { type ReactNode, useEffect } from "react";
import { shortWhen } from "../common/format.ts";
import { taskStateActions } from "../common/taskStateActions.tsx";
import { taskRowState } from "../common/taskStatus.ts";
import { DEFAULT_PID, isWorking, projectName } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { archiveTaskChats } from "../data/taskChats.ts";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { updateThread } from "../data/threadAdmin.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ListedChat } from "./Delegated.tsx";
import { SessionRow } from "./InboxViews.tsx";
import { ProjectBadge } from "./ProjectBadge.tsx";
import { FoldContext, useRowFold } from "./RowFold.tsx";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { useOpenRow } from "./useOpenRow.ts";

/**
 * One task in the Inbox: its latest chat's face, its title and when, then its state, how many chats and agents work
 * it and its project. A click opens its latest chat; the chevron by the title unfolds every chat (remembered).
 */
export function TaskBundle({ taskId, threads, selected }: { taskId: string; threads: Thread[]; selected?: string }) {
  const t = useT();
  const task = useTasks((s) => s.tasks[taskId]);
  const agents = useShownAgents();
  const projects = useData((s) => s.projects);
  const columns = useTasks((s) => s.columns);
  useEffect(() => ensureTask(taskId), [taskId]);
  const sorted = [...threads].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const latest = sorted[0];
  const archived = threads.every((th) => th.archived);
  const items: MenuEntry[] = [
    { label: t("tasks.menu.open"), icon: <Icons.PanelRight />, onSelect: () => go.task(taskId) },
    ...(latest
      ? [
          {
            label: latest.pinned ? t("thread.menu.unpin") : t("thread.menu.pin"),
            icon: <Icons.Pin />,
            onSelect: () => void updateThread(latest.id, { pinned: !latest.pinned }),
          },
        ]
      : []),
    ...(task ? taskStateActions(task, columns, t) : []),
    { type: "separator" },
    {
      label: t(archived ? "tasks.chats.unarchive" : "tasks.chats.archive"),
      icon: archived ? <Icons.ArchiveRestore /> : <Icons.Archive />,
      onSelect: () => void archiveTaskChats(taskId, !archived),
    },
  ];
  // The row is its latest chat; unfolding lists the task's other sessions.
  const others = sorted.slice(1);
  const [open, setOpen] = useOpenRow(
    `task:${taskId}`,
    others.some((th) => th.id === selected),
  );
  const running = threads.some((th) => isWorking(th.state));
  const unread = threads.reduce((n, th) => n + th.unread, 0);
  const who = new Set(threads.map((th) => th.agent_ids[0] ?? ""));
  const state = taskRowState(task, running, t);
  const project = task?.project_id ?? latest?.project_id ?? DEFAULT_PID;
  if (!latest) return null;
  return (
    <div className="taskbundle">
      <FoldContext.Provider
        value={
          others.length
            ? {
                open,
                toggle: () => setOpen(!open),
                label: t(open ? "inbox.taskBundle.close" : "inbox.taskBundle.open"),
              }
            : undefined
        }
      >
        <TaskRow
          thread={latest}
          items={items}
          title={task?.title ?? latest.title}
          selected={latest?.id === selected}
          unread={unread}
          running={running}
          preview={
            <span className="threadrow__line">
              <span className="threadrow__who">
                <span className={`routinerow__state is-${state.tone}`}>
                  <span className="routinerow__dot" />
                  {state.label}
                </span>
                <span className="inboxtask__count" title={t("inbox.taskBundle.chats", { n: threads.length })}>
                  <Icons.MessageSquare size={12} /> {threads.length}
                </span>
                <span className="inboxtask__count" title={t("inbox.taskBundle.agents", { n: who.size })}>
                  <Icons.Bot size={12} /> {who.size}
                </span>
              </span>
              <span className="threadrow__dot">·</span>
              <ProjectBadge id={project} name={projectName(projects, project)} />
            </span>
          }
        />
      </FoldContext.Provider>
      {open && others.length > 0 && (
        <div className="tree__sessions apx-branches">
          {others.map((th) => (
            <ListedChat key={th.id} thread={th} selected={selected}>
              <SessionRow
                thread={th}
                agent={agents[th.agent_ids[0] ?? ""]}
                selected={th.id === selected}
                withAgent
                label={lastSaid(th)}
              />
            </ListedChat>
          ))}
        </div>
      )}
    </div>
  );
}

/** Under its task every chat's title is the task's: what was said there last tells them apart. */
function lastSaid(thread: Thread): string | undefined {
  const line = thread.preview.split("\n").find((l) => l.trim());
  return line ? line.replace(/\*\*|`|^\s*(#+|>|[-*])\s+/g, "") : undefined;
}

function TaskRow(props: {
  thread: Thread;
  items: MenuEntry[];
  title: string;
  selected: boolean;
  unread: number;
  running: boolean;
  preview: ReactNode;
}) {
  const t = useT();
  const agents = useShownAgents();
  const fold = useRowFold();
  const { thread } = props;
  return (
    <div className="threadrow-wrap" ref={fold.wrap}>
      <ContextMenu items={props.items}>
        <ConversationRow
          className="threadrow inboxtask"
          selected={props.selected}
          onClick={() => go.thread(thread.id)}
          avatar={<ThreadAvatar thread={thread} agent={agents[thread.agent_ids[0] ?? ""]} size={24} slot={28} />}
          title={props.title}
          titleTag={
            <>
              {fold.slot}
              {props.running && <Spinner size={12} className="threadrow__spin" />}
            </>
          }
          time={shortWhen(thread.updated_at)}
          unread={props.unread}
          preview={props.preview}
        />
      </ContextMenu>
      {fold.button}
      <span className="threadrow__more">
        <Menu
          align="end"
          trigger={<IconButton size="sm" label={t("tasks.chats.actions")} icon={<Icons.Ellipsis size={14} />} />}
          items={props.items}
        />
      </span>
    </div>
  );
}
