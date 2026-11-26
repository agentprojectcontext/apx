import type { Task } from "@apx/protocol";
import { taskGroupOf } from "@apx/protocol/task-groups";
import { isPending } from "../data/identity.ts";
import type { ListEntry } from "./groupThreads.ts";

type Entry = Extract<ListEntry, { kind: "task" }>;
/** The sections in their default order; the owner can put them in another (prefs' inboxTaskOrder). */
const TASK_SECTIONS = ["doing", "waiting", "pending", "done", "dropped"] as const;
type TaskSectionId = (typeof TASK_SECTIONS)[number];

/**
 * Only the rows in this Inbox result count; filtering and the chat list's page cap stay intact. Sections follow the
 * owner's `order`, the ones it leaves out in their default place after.
 */
export function taskSections(
  entries: readonly Entry[],
  tasks: Readonly<Record<string, Task>>,
  order: readonly string[] = [],
) {
  const groups = new Map<TaskSectionId, Entry[]>(TASK_SECTIONS.map((id) => [id, []]));
  for (const entry of entries) {
    const task = tasks[entry.taskId];
    let section: TaskSectionId = "pending";
    if (task?.state === "done" || task?.state === "dropped") section = task.state;
    else if (task?.awaits_owner || (task?.status === "review" && task.reviewer === "owner")) section = "waiting";
    else if (task) {
      const running = new Set(entry.threads.some((th) => isPending(th.state)) ? [task.thread_id] : []);
      const group = taskGroupOf(task, running);
      section = group === "doing" ? "doing" : group === "blocked" ? "waiting" : "pending";
    } else if (entry.threads.some((th) => isPending(th.state))) section = "doing";
    groups.get(section)?.push(entry);
  }
  return sectionOrder(order).flatMap((id) => {
    const rows = groups.get(id) ?? [];
    return rows.length ? [{ id, entries: rows }] : [];
  });
}

/** Every section id, in the owner's `order` first (unknown ids dropped), the rest in their default order. */
export function sectionOrder(order: readonly string[]): TaskSectionId[] {
  const known = order.filter((id): id is TaskSectionId => (TASK_SECTIONS as readonly string[]).includes(id));
  return [...new Set([...known, ...TASK_SECTIONS])];
}

/**
 * The full order once `id` is dropped before `before` (a section on screen; none: after the last one on screen).
 * Sections not on screen (empty now) keep their place relative to the others.
 */
export function movedSection(order: readonly string[], id: string, before: string | undefined, last?: string) {
  const ids: string[] = sectionOrder(order).filter((x) => x !== id);
  const at = before ? ids.indexOf(before) : last ? ids.indexOf(last) + 1 : ids.length;
  ids.splice(at < 0 ? ids.length : at, 0, id);
  return ids;
}
