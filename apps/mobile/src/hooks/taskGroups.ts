import { taskGroupOf as groupOf } from "../../../../packages/protocol/src/task-groups.ts";
import { textOrder } from "../format.ts";
import type { Key } from "../i18n/index.ts";
import type { Task, Thread } from "./useWorkspace";

export type TaskFilter = "all" | "task" | "commitment";
export type TaskGroup = { id: "proposed" | "doing" | "pending" | "review" | "blocked"; label: Key; tasks: Task[] };

const ORDER: Array<Pick<TaskGroup, "id" | "label">> = [
  { id: "proposed", label: "tasksProposed" },
  { id: "blocked", label: "tasksBlocked" },
  { id: "doing", label: "tasksDoing" },
  { id: "pending", label: "tasksPending" },
  { id: "review", label: "tasksReview" },
];

/** Where an open task sits on the phone: the same group as in the panel (DECISIONS.md#d-129). */
export function taskGroupOf(task: Task, running: ReadonlySet<string> = new Set()): TaskGroup["id"] {
  const group = groupOf(task, running);
  return group === "closed" ? "pending" : group;
}

/** The chats with a turn going on, and the task threads of the tasks worked in them: such a task is in progress. */
export function runningThreads(threads: readonly Thread[], tasks: readonly Task[]): Set<string> {
  const live = threads.filter((thread) => LIVE.has(thread.state));
  const worked = new Set(live.flatMap((thread) => (thread.task_id ? [thread.task_id] : [])));
  return new Set([
    ...live.map((thread) => thread.id),
    ...tasks.filter((task) => worked.has(task.id)).map((task) => task.thread_id),
  ]);
}

const LIVE = new Set(["queued", "submitted", "working"]);

const shownBy = (filter: TaskFilter) => (task: Task) =>
  filter === "all" || (filter === "commitment" ? task.kind === "commitment" : task.kind !== "commitment");

/** Open tasks by group, in the design's order, leaving out empty groups; errands count as tasks. */
export function taskGroups(tasks: Task[], filter: TaskFilter, running: ReadonlySet<string> = new Set()): TaskGroup[] {
  const shown = tasks.filter((task) => task.state === "open" && shownBy(filter)(task));
  const soonest = (a: Task, b: Task) => textOrder(a.due_at ?? "~", b.due_at ?? "~");
  return ORDER.map((group) => ({
    ...group,
    tasks: shown.filter((task) => taskGroupOf(task, running) === group.id).sort(soonest),
  })).filter((group) => group.tasks.length > 0);
}

/** The closed tasks the filter shows, the latest first (done and dropped alike). */
export function closedTasks(tasks: Task[], filter: TaskFilter): Task[] {
  return tasks
    .filter((task) => task.state !== "open" && shownBy(filter)(task))
    .sort((a, b) => textOrder(b.activity_at, a.activity_at));
}
