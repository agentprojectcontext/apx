import type { Task } from "@apx/protocol";
import { taskGroupOf } from "@apx/protocol/task-groups";
import { isPending } from "../data/identity.ts";
import type { ListEntry } from "./groupThreads.ts";

type Entry = Extract<ListEntry, { kind: "task" }>;
const TASK_SECTIONS = ["doing", "waiting", "pending", "dropped", "done"] as const;
type TaskSectionId = (typeof TASK_SECTIONS)[number];

/** Only the rows in this Inbox result count; filtering and the chat list's page cap stay intact. */
export function taskSections(entries: readonly Entry[], tasks: Readonly<Record<string, Task>>) {
  const groups = new Map<TaskSectionId, Entry[]>(TASK_SECTIONS.map((id) => [id, []]));
  for (const entry of entries) {
    const task = tasks[entry.taskId];
    let section: TaskSectionId = "pending";
    if (task?.state === "done" || task?.state === "dropped") section = task.state;
    else if (task) {
      const running = new Set(entry.threads.some((th) => isPending(th.state)) ? [task.thread_id] : []);
      const group = taskGroupOf(task, running);
      section = group === "doing" ? "doing" : group === "blocked" ? "waiting" : "pending";
    } else if (entry.threads.some((th) => isPending(th.state))) section = "doing";
    groups.get(section)?.push(entry);
  }
  return TASK_SECTIONS.flatMap((id) => {
    const rows = groups.get(id) ?? [];
    return rows.length ? [{ id, entries: rows }] : [];
  });
}
