import { Icons } from "@apx/ui";
import { type ReactElement, type ReactNode, useEffect } from "react";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

/** A task id as the core mints it (task_ + hex). */
const TASK_ID = /^task_[0-9a-f]{8,}$/;

/** A task an agent names in its text (`task_…`): its title with the tasks icon; a click opens it over the chat. */
function TaskChip({ id, code }: { id: string; code: ReactElement }) {
  const t = useT();
  const task = useTasks((s) => s.tasks[id]);
  useEffect(() => ensureTask(id), [id]);
  if (!task) return code;
  return (
    <button
      type="button"
      className={task.state === "open" ? "taskchip" : "taskchip is-closed"}
      title={t("tasks.chipHint", { id })}
      onClick={() => go.task(id)}
    >
      <Icons.ListChecks size={12} className="taskchip__icon" />
      <span className="taskchip__title">{task.title}</span>
    </button>
  );
}

/** MarkdownView's renderCodeSpan: a task id becomes its chip, any other code stays code. */
export function taskCodeSpan(text: string, code: ReactElement, key: string): ReactNode {
  return TASK_ID.test(text) ? <TaskChip key={key} id={text} code={code} /> : code;
}
