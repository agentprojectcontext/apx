// How the Tasks list groups tasks: what is moving first, what is blocked on the owner last before the closed ones.
// Pure, so it is tested on its own.
import type { Task } from "@apx/protocol";

export type GroupId = "doing" | "pending" | "review" | "blocked" | "closed";
export const GROUP_ORDER: readonly GroupId[] = ["doing", "pending", "review", "blocked", "closed"];

/**
 * Blocked (waiting for the owner) wins over every column; then a task whose thread has a turn running counts as in
 * progress whatever its column; `review` is review; any other open column (backlog, to do, the owner's own) is pending.
 */
export function groupOf(task: Task, running: ReadonlySet<string>): GroupId {
  if (task.state !== "open") return "closed";
  if (task.awaits_owner) return "blocked";
  if (task.status === "doing" || running.has(task.thread_id)) return "doing";
  if (task.status === "review") return "review";
  return "pending";
}

/** Groups in order, empty ones left out. Open tasks by last activity; closed ones too, newest first. */
export function groupTasks(tasks: Task[], running: ReadonlySet<string>): Array<{ id: GroupId; items: Task[] }> {
  const by = new Map<GroupId, Task[]>();
  for (const task of [...tasks].sort((a, b) => b.activity_at.localeCompare(a.activity_at))) {
    const g = groupOf(task, running);
    by.set(g, [...(by.get(g) ?? []), task]);
  }
  return GROUP_ORDER.flatMap((id) => (by.get(id)?.length ? [{ id, items: by.get(id) ?? [] }] : []));
}
