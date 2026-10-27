import type { Thread } from "@apx/protocol";
import { ContextMenu, IconButton, Icons, Menu, type MenuEntry, Spinner } from "@apx/ui";
import { useState } from "react";
import { AgentFace } from "../common/AgentFace.tsx";
import { shortWhen } from "../common/format.ts";
import { taskStateActions } from "../common/taskStateActions.tsx";
import { isWorking } from "../data/identity.ts";
import { useShownAgents } from "../data/state.ts";
import { archiveTaskChats } from "../data/taskChats.ts";
import { useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { TaskStatus } from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { ListedChat } from "./Delegated.tsx";
import { SessionRow } from "./InboxViews.tsx";

const cx = (...c: Array<string | false>) => c.filter(Boolean).join(" ");

/** Tasks the owner folded, kept while the panel is open so switching views or lists does not unfold them. */
const folded = new Set<string>();

/**
 * Every chat the agents keep for one task, as one row of a list: the task, who works it and whether it runs, with each
 * agent's chat nested under it, open until folded. The row only folds and unfolds; a chat's "Open the task" opens it.
 */
export function TaskBundle({ taskId, threads, selected }: { taskId: string; threads: Thread[]; selected?: string }) {
  const t = useT();
  const task = useTasks((s) => s.tasks[taskId]);
  const agents = useShownAgents();
  const columns = useTasks((s) => s.columns);
  const archived = threads.every((th) => th.archived);
  const items: MenuEntry[] = [
    { label: t("tasks.menu.open"), icon: <Icons.PanelRight />, onSelect: () => go.task(taskId) },
    ...(task ? taskStateActions(task, columns, t) : []),
    { type: "separator" },
    {
      label: t(archived ? "tasks.chats.unarchive" : "tasks.chats.archive"),
      icon: archived ? <Icons.ArchiveRestore /> : <Icons.Archive />,
      onSelect: () => void archiveTaskChats(taskId, !archived),
    },
  ];
  const [open, setOpenState] = useState(() => !folded.has(taskId) || threads.some((th) => th.id === selected));
  const setOpen = (next: boolean) => {
    if (next) folded.delete(taskId);
    else folded.add(taskId);
    setOpenState(next);
  };
  const running = threads.some((th) => isWorking(th.state));
  const waiting = threads.some((th) => th.state === "input-required");
  const unread = threads.reduce((n, th) => n + th.unread, 0);
  const who = [...new Set(threads.map((th) => th.agent_ids[0] ?? ""))].map((id) => agents[id]).filter(Boolean);
  const title = task?.title ?? threads[0]?.title ?? taskId;
  return (
    <div className="taskbundle">
      <ContextMenu items={items} render={<div className={cx("taskbundle__head", unread > 0 && "is-unread")} />}>
        <button
          type="button"
          className="taskbundle__task"
          aria-expanded={open}
          title={open ? t("inbox.taskBundle.close") : t("inbox.taskBundle.open")}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <Icons.ChevronDown size={14} className="taskbundle__chevron" />
          ) : (
            <Icons.ChevronRight size={14} className="taskbundle__chevron" />
          )}
          <Icons.ListChecks size={14} className="taskbundle__icon" />
          {running && <Spinner size={12} />}
          {waiting && <Icons.Hand size={12} className="tree__waiting" />}
          <TaskStatus id={taskId}>
            <span className="taskbundle__title">{title}</span>
          </TaskStatus>
          <span className="taskbundle__faces" aria-hidden>
            {who.slice(0, 3).map((a) => a && <AgentFace key={a.id} agent={a} size={16} />)}
          </span>
          <span className="tree__agentmeta">{t("inbox.taskBundle.chats", { n: threads.length })}</span>
          {unread > 0 && <span className="tree__unread">{unread}</span>}
          <span className="tree__when">{shortWhen(threads[0]?.updated_at ?? "")}</span>
        </button>
        <Menu
          items={items}
          trigger={<IconButton size="sm" label={t("tasks.chats.actions")} icon={<Icons.Ellipsis size={14} />} />}
        />
      </ContextMenu>
      {open && (
        <div className="tree__sessions">
          {threads.map((th) => (
            <ListedChat key={th.id} thread={th} selected={selected}>
              <SessionRow thread={th} agent={agents[th.agent_ids[0] ?? ""]} selected={th.id === selected} withAgent />
            </ListedChat>
          ))}
        </div>
      )}
    </div>
  );
}
