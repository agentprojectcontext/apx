import type { Result, Task, Thread } from "@apx/protocol";
import { AgentAvatar, Icons, Skeleton, Spinner } from "@apx/ui";
import { formatNumber, shortWhen } from "../common/format.ts";
import { blobOf, isWorking } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { formatCompact } from "./compact.ts";

/**
 * Everything a task was worked in, newest first: the chats of the agents that took it, and the consults of the
 * teammates asked on it. Who, how it is going, and a way into each (it opens in the inbox).
 */
export function TaskWork({
  task,
  sessions,
  consults = [],
}: {
  task: Task;
  sessions: Thread[] | undefined;
  consults?: Thread[] | undefined;
}) {
  const t = useT();
  const agents = useShownAgents();
  const live = useData((s) => s.threads);
  if (!sessions) return <Skeleton width={180} />;
  if (!sessions.length && !consults.length)
    return <span className="taskwork__none">{t(task.assignee ? "tasks.work.notYet" : "tasks.work.none")}</span>;
  const all = [...sessions, ...consults].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return (
    <div className="taskwork">
      {all.map((s) => {
        const chat = live[s.id] ?? s;
        const agent = agents[s.agent_ids[0] ?? ""];
        const name = agent?.name ?? s.agent_ids[0] ?? "";
        const consult = s.kind === "a2a";
        return (
          <button
            key={s.id}
            type="button"
            className="taskwork__chat"
            title={t(consult ? "tasks.work.openConsult" : "tasks.work.open", { name })}
            onClick={() => (consult ? go.subthread(s.id) : go.thread(s.id))}
          >
            <AgentAvatar name={name} blob={blobOf(agent)} size={18} animated={false} />
            <span className="taskwork__name">{name}</span>
            {consult && <span className="taskwork__kind">{t("tasks.work.consult")}</span>}
            <span className="taskwork__state">
              {isWorking(chat.state) ? (
                <>
                  <Spinner size={11} />
                  {t("tasks.work.working")}
                </>
              ) : (
                shortWhen(chat.updated_at)
              )}
            </span>
            <Icons.ChevronRight size={13} className="taskwork__go" />
          </button>
        );
      })}
    </div>
  );
}

/** What every turn on the task took: tokens in and out, summed and by model. */
export function TaskUsage({ usage }: { usage: Result<"tasks.get">["usage"] }) {
  const t = useT();
  const sum = usage.reduce(
    (a, u) => ({ input: a.input + u.input, output: a.output + u.output, runs: a.runs + u.runs }),
    {
      input: 0,
      output: 0,
      runs: 0,
    },
  );
  return (
    <div className="taskusage">
      <span className="taskusage__total">
        {t("tasks.usage.value", {
          input: formatCompact(sum.input),
          output: formatCompact(sum.output),
          runs: formatNumber(sum.runs),
        })}
      </span>
      {usage.map((u) => (
        <span key={u.model} className="taskusage__model">
          <code>{u.model}</code> ·{" "}
          {t("tasks.usage.model", { input: formatCompact(u.input), output: formatCompact(u.output) })}
        </span>
      ))}
    </div>
  );
}

/** The tasks under this one (an agent working it made them), each opening as a task. */
export function TaskSubtasks({ subtasks }: { subtasks: Task[] }) {
  const t = useT();
  const agents = useShownAgents();
  const live = useTasks((s) => s.tasks);
  return (
    <div className="taskwork">
      {subtasks.map((st) => {
        const task = live[st.id] ?? st;
        const agent = agents[task.assignee ?? ""];
        const name = agent?.name ?? task.assignee ?? t("tasks.nobody");
        return (
          <button
            key={task.id}
            type="button"
            className="taskwork__chat"
            title={t("tasks.subtask.open", { title: task.title })}
            onClick={() => go.task(task.id)}
          >
            {task.state === "done" ? (
              <Icons.Check size={13} className="taskwork__go" />
            ) : task.state === "dropped" ? (
              <Icons.X size={13} className="taskwork__go" />
            ) : task.assignee ? (
              <AgentAvatar name={name} blob={blobOf(agent)} size={18} animated={false} />
            ) : (
              <Icons.CircleDashed size={13} className="taskwork__go" />
            )}
            <span className={`taskwork__title${task.state === "dropped" ? " is-dropped" : ""}`}>{task.title}</span>
            <span className="taskwork__state">
              {task.state === "open" ? name : t(task.state === "done" ? "tasks.markDone" : "tasks.dropped")}
            </span>
            <Icons.ChevronRight size={13} className="taskwork__go" />
          </button>
        );
      })}
    </div>
  );
}

/** The task this one is a subtask of, opening it. */
export function TaskParent({ id }: { id: string }) {
  const t = useT();
  const parent = useTasks((s) => s.tasks[id]);
  const title = parent?.title ?? id;
  return (
    <button
      type="button"
      className="taskwork__chat"
      title={t("tasks.subtask.open", { title })}
      onClick={() => go.task(id)}
    >
      <Icons.ListChecks size={13} className="taskwork__go" />
      <span className="taskwork__title">{title}</span>
      <Icons.ChevronRight size={13} className="taskwork__go" />
    </button>
  );
}
