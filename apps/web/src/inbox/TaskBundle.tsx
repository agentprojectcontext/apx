import "../styles/inbox-parts.css";
import type { Thread } from "@apx/protocol";
import { Button, ContextMenu, ConversationRow, IconButton, Icons, Menu, type MenuEntry, Spinner } from "@apx/ui";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { ASKED, namedMentions } from "../common/mentionNames.ts";
import { taskStateActions } from "../common/taskStateActions.tsx";
import { taskRowState } from "../common/taskStatus.ts";
import { loadDelegated } from "../data/actions.ts";
import { DEFAULT_PID, DELEGATED_SHOWN, isWorking, projectName } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { archiveTaskChats } from "../data/taskChats.ts";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { updateThread } from "../data/threadAdmin.ts";
import { useT } from "../i18n/index.ts";
import { TaskStatusHint } from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { ListedChat } from "./Delegated.tsx";
import { delegatedByChat, tookPart } from "./groupThreads.ts";
import { SessionRow } from "./InboxViews.tsx";
import { ProjectBadge } from "./ProjectBadge.tsx";
import { FoldContext, useRowFold } from "./RowFold.tsx";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { useOpenRow } from "./useOpenRow.ts";

const NONE: Thread[] = [];

/**
 * One task in the Inbox: its latest chat's face, its title and when, then its state, how many chats and agents work
 * it and its project. A click opens its latest chat; the chevron by the title unfolds its other chats and the
 * conversations of the teammates asked on it (remembered).
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
  // The row is its latest chat; unfolding lists the task's other sessions and its teammates' conversations.
  const others = sorted.slice(1);
  const home = task?.thread_id;
  const loaded = useData((s) => s.threads);
  const teammates = (home && delegatedByChat(loaded).get(home)) || NONE;
  const counted = useData((s) => (home ? (s.delegated[home] ?? 0) : 0));
  const asked = Math.max(counted, teammates.length);
  const [open, setOpen] = useOpenRow(
    `task:${taskId}`,
    [...others, ...teammates].some((th) => th.id === selected),
  );
  const chats = threads.length + asked;
  const running = threads.some((th) => isWorking(th.state));
  const unread = threads.reduce((n, th) => n + th.unread, 0);
  const who = tookPart(task?.agents, threads);
  const names = [...who].map((id) => agents[id]?.name ?? id);
  const state = taskRowState(task, running, t);
  const project = task?.project_id ?? latest?.project_id ?? DEFAULT_PID;
  if (!latest) return null;
  return (
    <div className="taskbundle">
      <FoldContext.Provider
        value={
          others.length || asked
            ? {
                open,
                toggle: () => setOpen(!open),
                label: t(open ? "inbox.taskBundle.close" : "inbox.taskBundle.open"),
              }
            : undefined
        }
      >
        <TaskRow
          taskId={taskId}
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
                <span className="inboxtask__count" title={t("inbox.taskBundle.chats", { n: chats })}>
                  <Icons.MessageSquare size={12} /> {chats}
                </span>
                <span
                  className="inboxtask__count"
                  title={`${t("inbox.taskBundle.agents", { n: who.size })}: ${names.join(", ")}`}
                >
                  <Icons.Bot size={12} /> {who.size}
                </span>
              </span>
              <span className="threadrow__dot">·</span>
              <ProjectBadge id={project} name={projectName(projects, project)} />
            </span>
          }
        />
      </FoldContext.Provider>
      {open && chats > 1 && (
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
          {home && <Teammates home={home} kids={teammates} total={asked} selected={selected} />}
        </div>
      )}
    </div>
  );
}

/**
 * The conversations of the teammates asked on a task, newest first: a few, then the rest on request. Each opens as the
 * chat, as a delegated chat does under its caller in Chats (see DECISIONS.md#d-225).
 */
function Teammates(props: { home: string; kids: Thread[]; total: number; selected: string | undefined }) {
  const t = useT();
  const agents = useShownAgents();
  const [all, setAll] = useState(false);
  const listed = all ? props.kids : props.kids.slice(0, DELEGATED_SHOWN);
  const more = props.total - listed.length;
  const showMore = () => {
    setAll(true);
    if (props.kids.length < props.total) void loadDelegated(props.home);
  };
  return (
    <>
      {listed.map((k) => (
        <ListedChat key={k.id} thread={k} selected={props.selected} nested ancestors={[props.home]}>
          <SessionRow
            thread={k}
            agent={agents[k.agent_ids[0] ?? ""]}
            selected={k.id === props.selected}
            withAgent
            label={namedMentions(k.title.replace(ASKED, ""), agents, k.agent_ids[0])}
          />
        </ListedChat>
      ))}
      {more > 0 && (
        <Button variant="link" size="sm" className="tree__more" onClick={showMore}>
          {t("inbox.showMore", { n: more })}
        </Button>
      )}
    </>
  );
}

/** Under its task every chat's title is the task's: what was said there last tells them apart. */
function lastSaid(thread: Thread): string | undefined {
  const line = thread.preview.split("\n").find((l) => l.trim());
  return line ? line.replace(/\*\*|`|^\s*(#+|>|[-*])\s+/g, "") : undefined;
}

function TaskRow(props: {
  taskId: string;
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
          title={
            <Suspense fallback={<span className="taskbundle__title">{props.title}</span>}>
              <TaskStatusHint id={props.taskId}>
                <span className="taskbundle__title">{props.title}</span>
              </TaskStatusHint>
            </Suspense>
          }
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
