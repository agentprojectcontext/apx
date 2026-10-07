import type { Key } from "../i18n/index.ts";
import type { Task } from "./useWorkspace";

export type TaskFilter = "all" | "task" | "commitment";
export type TaskGroup = { id: "doing" | "pending" | "review" | "blocked"; label: Key; tasks: Task[] };

const ORDER: Array<Pick<TaskGroup, "id" | "label">> = [
  { id: "doing", label: "tasksDoing" },
  { id: "pending", label: "tasksPending" },
  { id: "review", label: "tasksReview" },
  { id: "blocked", label: "tasksBlocked" },
];

/** Where an open task sits on the phone: waiting on the owner first, then its board column. */
export function taskGroupOf(task: Task): TaskGroup["id"] {
  if (task.awaits_owner || task.status === "blocked") return "blocked";
  if (task.status === "review") return "review";
  if (task.status === "doing") return "doing";
  return "pending";
}

/** Open tasks by group, in the design's order, leaving out empty groups; errands count as tasks. */
export function taskGroups(tasks: Task[], filter: TaskFilter): TaskGroup[] {
  const shown = tasks.filter(
    (task) =>
      task.state === "open" &&
      (filter === "all" || (filter === "commitment" ? task.kind === "commitment" : task.kind !== "commitment")),
  );
  const soonest = (a: Task, b: Task) => (a.due_at ?? "~").localeCompare(b.due_at ?? "~");
  return ORDER.map((group) => ({
    ...group,
    tasks: shown.filter((task) => taskGroupOf(task) === group.id).sort(soonest),
  })).filter((group) => group.tasks.length > 0);
}
