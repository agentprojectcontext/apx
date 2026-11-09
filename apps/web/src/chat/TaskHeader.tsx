import type { Thread } from "@apx/protocol";
import { Button, Icons, Menu } from "@apx/ui";
import { useEffect, useMemo } from "react";
import { shortWhen } from "../common/format.ts";
import { taskRowState } from "../common/taskStatus.ts";
import { isWorking } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { ThreadAvatar } from "../inbox/ThreadAvatar.tsx";
import { go, nav, useNav } from "../shell/nav.ts";

/** Every chat its agents keep for one task, latest first. */
function useTaskChats(taskId: string): Thread[] {
  const threads = useData((s) => s.threads);
  return useMemo(
    () =>
      Object.values(threads)
        .filter((th) => th.task_id === taskId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [threads, taskId],
  );
}

/** Beside a task chat's title: the task's state; a click shows the task beside the chat, a second one hides it. */
export function TaskStateButton({ taskId }: { taskId: string }) {
  const t = useT();
  const task = useTasks((s) => s.tasks[taskId]);
  const chats = useTaskChats(taskId);
  const open = useNav((s) => s.peekTaskId === taskId);
  useEffect(() => ensureTask(taskId), [taskId]);
  const state = taskRowState(
    task,
    chats.some((th) => isWorking(th.state)),
    t,
  );
  return (
    <Button
      size="sm"
      variant="secondary"
      className={open ? "chat__taskbtn is-on" : "chat__taskbtn"}
      title={t(open ? "tasks.header.hide" : "tasks.header.show")}
      aria-pressed={open}
      leadingIcon={<Icons.ListChecks size={14} />}
      onClick={() => (open ? nav.set({ peekTaskId: undefined }) : go.task(taskId))}
    >
      <span className={`routinerow__state is-${state.tone}`}>
        <span className="routinerow__dot" />
        {state.label}
      </span>
    </Button>
  );
}

/** Under a task chat's title: "Task", whose session this is (the others one pick away) and who works the task. */
export function TaskCrumb({ thread, taskId }: { thread: Thread; taskId: string }) {
  const t = useT();
  const agents = useShownAgents();
  const chats = useTaskChats(taskId);
  const name = (th: Thread) => agents[th.agent_ids[0] ?? ""]?.name ?? th.title;
  const who = [...new Set(chats.map(name))];
  return (
    <>
      <span>{t("tasks.header.task")}</span>
      {who.length > 0 && <span className="chat__taskwho">{who.join(", ")}</span>}
      <Menu
        align="start"
        className="tasksess__menu"
        trigger={
          <Button
            size="sm"
            variant="outline"
            className="chat__sessions"
            trailingIcon={<Icons.ChevronDown size={12} />}
          >
            {t("tasks.header.session", { name: name(thread) })}
          </Button>
        }
        items={[
          { type: "label", label: t("tasks.header.sessions") },
          ...chats.map((th) => ({
            label: (
              <span className="tasksess">
                <span className="tasksess__name">{name(th)}</span>
                <span className="tasksess__said">
                  {th.preview.split("\n").find((l) => l.trim()) ?? t("tasks.header.noWords")}
                </span>
              </span>
            ),
            icon: <ThreadAvatar thread={th} agent={agents[th.agent_ids[0] ?? ""]} size={20} slot={22} />,
            shortcut: shortWhen(th.updated_at),
            checked: th.id === thread.id,
            onSelect: () => go.thread(th.id),
          })),
        ]}
      />
    </>
  );
}
