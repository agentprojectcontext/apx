import "../styles/inbox-parts.css";
import { Badge, Tooltip } from "@apx/ui";
import { type ReactElement, useEffect } from "react";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { taskStatus, taskStatusTone } from "./taskStatus.ts";

/** A task's title in a list: resting on it shows the whole title and the task's status, in the theme on screen. */
export function TaskStatusHint({ id, children }: { id: string; children: ReactElement }) {
  const t = useT();
  const task = useTasks((s) => s.tasks[id]);
  const columns = useTasks((s) => s.columns);
  useEffect(() => ensureTask(id), [id]);
  if (!task) return children;
  return (
    <Tooltip
      content={
        <span className="task-status-hint">
          <span className="task-status-hint__title">{task.title}</span>
          <Badge tone={taskStatusTone(task)} dot>
            {taskStatus(task, columns, t)}
          </Badge>
        </span>
      }
      appearance="surface"
    >
      {children}
    </Tooltip>
  );
}
