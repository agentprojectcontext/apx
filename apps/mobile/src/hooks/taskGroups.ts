import type { Key } from "../i18n/index.ts";
import type { Task } from "./useWorkspace";

export type TaskFilter = "all" | "task" | "commitment";
export type TaskGroup = { id: "proposed" | "doing" | "pending" | "review" | "blocked"; label: Key; tasks: Task[] };

const ORDER: Array<Pick<TaskGroup, "id" | "label">> = [
  { id: "proposed", label: "tasksProposed" },
  { id: "blocked", label: "tasksBlocked" },
  { id: "doing", label: "tasksDoing" },
  { id: "pending", label: "tasksPending" },
  { id: "review", label: "tasksReview" },
];

/**
 * Where an open task sits on the phone: an agent's proposals first, then what needs the owner (a question, or a review
 * no agent does), then its board column.
 */
export function taskGroupOf(task: Task): TaskGroup["id"] {
  if (task.proposed) return "proposed";
  if (task.awaits_owner || task.status === "blocked" || (task.status === "review" && !task.reviewer)) return "blocked";
  if (task.status === "review") return "review";
  if (task.status === "doing") return "doing";
  return "pending";
}

const shownBy = (filter: TaskFilter) => (task: Task) =>
  filter === "all" || (filter === "commitment" ? task.kind === "commitment" : task.kind !== "commitment");

/** Open tasks by group, in the design's order, leaving out empty groups; errands count as tasks. */
export function taskGroups(tasks: Task[], filter: TaskFilter): TaskGroup[] {
  const shown = tasks.filter((task) => task.state === "open" && shownBy(filter)(task));
  const soonest = (a: Task, b: Task) => (a.due_at ?? "~").localeCompare(b.due_at ?? "~");
  return ORDER.map((group) => ({
    ...group,
    tasks: shown.filter((task) => taskGroupOf(task) === group.id).sort(soonest),
  })).filter((group) => group.tasks.length > 0);
}

/** The closed tasks the filter shows, the latest first (done and dropped alike). */
export function closedTasks(tasks: Task[], filter: TaskFilter): Task[] {
  return tasks
    .filter((task) => task.state !== "open" && shownBy(filter)(task))
    .sort((a, b) => b.activity_at.localeCompare(a.activity_at));
}
