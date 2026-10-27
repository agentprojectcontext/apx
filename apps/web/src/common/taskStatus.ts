import type { Task, TaskColumn } from "@apx/protocol";
import type { MessageKey, T } from "../i18n/index.ts";

const COLUMN_KEYS: Record<string, MessageKey> = {
  backlog: "tasks.col.backlog",
  todo: "tasks.col.todo",
  doing: "tasks.col.doing",
  review: "tasks.col.review",
};

/** Default columns are translated; custom columns keep the owner's label. */
export const columnLabel = (c: TaskColumn, t: T) => {
  const key = COLUMN_KEYS[c.id];
  return key ? t(key) : c.label;
};

export function taskStatusTone(task: Task): "brand" | "neutral" | "danger" | "warning" | "violet" | "info" {
  if (task.state !== "open") return task.state === "done" ? "brand" : "danger";
  if (task.awaits_owner) return "warning";
  if (task.proposed || task.status === "review") return "violet";
  return task.status === "doing" ? "info" : "neutral";
}

export function taskStatus(task: Task, columns: readonly TaskColumn[], t: T): string {
  if (task.state !== "open") return t(task.state === "done" ? "tasks.done" : "tasks.dropped");
  if (task.awaits_owner) return t("tasks.group.blocked");
  if (task.proposed) return t("tasks.group.proposed");
  const column = columns.find((c) => c.id === task.status);
  return column ? columnLabel(column, t) : t("tasks.state.open");
}
