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

/** What dropping a task on a group does: a column, waiting for the owner, or done. */
export type GroupMove = { status: string; awaits_owner: false } | { awaits_owner: true } | { done: true };

export function moveTo(group: GroupId, columns: readonly { id: string }[]): GroupMove {
  if (group === "closed") return { done: true };
  if (group === "blocked") return { awaits_owner: true };
  const has = (id: string) => columns.some((c) => c.id === id);
  if (group === "doing" && has("doing")) return { status: "doing", awaits_owner: false };
  if (group === "review" && has("review")) return { status: "review", awaits_owner: false };
  // Pending: "to do" when the board has it, else the first column that is not in progress or review.
  const pending = has("todo") ? "todo" : columns.find((c) => c.id !== "doing" && c.id !== "review")?.id;
  return { status: pending ?? columns[0]?.id ?? "todo", awaits_owner: false };
}
