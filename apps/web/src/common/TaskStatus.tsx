import { Badge, Tooltip } from "@apx/ui";
import { type ReactElement, useEffect } from "react";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { taskStatus, taskStatusTone } from "./taskStatus.ts";

/** In lists the title stays clean; inside the chat the persisted status stays visible. */
export function TaskStatus({ id, children }: { id: string; children?: ReactElement }) {
  const t = useT();
  const task = useTasks((s) => s.tasks[id]);
  const columns = useTasks((s) => s.columns);
  useEffect(() => ensureTask(id), [id]);
  if (!task) return children ?? null;
  const label = taskStatus(task, columns, t);
  const badge = (
    <Badge tone={taskStatusTone(task)} dot>
      {label}
    </Badge>
  );
  return children ? (
    <Tooltip
      content={
        <span className="task-status-hint">
          <span className="task-status-hint__title">{task.title}</span>
          {badge}
        </span>
      }
      appearance="surface"
    >
      {children}
    </Tooltip>
  ) : (
    <span className="task-status" role="status" title={label}>
      {badge}
    </span>
  );
}
