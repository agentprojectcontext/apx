import { Tag } from "@apx/ui";
import { useEffect } from "react";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { taskStatus } from "./taskStatus.ts";

/** The persisted task state, independent of whether its chat currently has a running turn. */
export function TaskStatus({ id }: { id: string }) {
  const t = useT();
  const task = useTasks((s) => s.tasks[id]);
  const columns = useTasks((s) => s.columns);
  useEffect(() => ensureTask(id), [id]);
  return task ? (
    <span className="task-status" role="status">
      <Tag>{taskStatus(task, columns, t)}</Tag>
    </span>
  ) : null;
}
