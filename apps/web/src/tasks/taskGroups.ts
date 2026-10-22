// How the Tasks list groups tasks: what needs the owner first (a question, or a review that is theirs), then what is
// moving, what waits, what an agent reviews, and the closed ones. Pure, so it is tested on its own.
import type { Task } from "@apx/protocol";

export type GroupId = "proposed" | "doing" | "pending" | "review" | "blocked" | "closed";
export const GROUP_ORDER: readonly GroupId[] = ["proposed", "blocked", "doing", "pending", "review", "closed"];

/**
 * What needs the owner wins over every column ("blocked": a question for them, or a review with no agent to do it);
 * then a task whose thread has a turn running counts as in progress whatever its column; `review` is an agent's review;
 * any other open column (backlog, to do, the owner's own) is pending.
 */
export function groupOf(task: Task, running: ReadonlySet<string>): GroupId {
  if (task.state !== "open") return "closed";
  // An agent's proposal: nothing starts until the owner accepts it.
  if (task.proposed) return "proposed";
  if (task.awaits_owner || (task.status === "review" && !task.reviewer)) return "blocked";
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

/**
 * Subtasks under their parent, as in Asana or Jira: `top` are the tasks whose parent is not among these (or that sit
 * in a loop of parents), `children` each parent's subtasks, oldest first (the order they were split in).
 */
export function nestTasks(tasks: readonly Task[]): { top: Task[]; children: Map<string, Task[]> } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const nested = (task: Task) => {
    const seen = new Set([task.id]);
    for (let up = task.parent_id; up && byId.has(up); up = byId.get(up)?.parent_id) {
      if (seen.has(up)) return false;
      seen.add(up);
    }
    return Boolean(task.parent_id && byId.has(task.parent_id));
  };
  const top: Task[] = [];
  const children = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!nested(task)) top.push(task);
    else children.set(task.parent_id as string, [...(children.get(task.parent_id as string) ?? []), task]);
  }
  for (const list of children.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { top, children };
}

/** What dropping a task on a group does: a column, waiting for the owner, or done. */
export type GroupMove = { status: string; awaits_owner: false } | { awaits_owner: true } | { done: true };

export function moveTo(group: GroupId, columns: readonly { id: string }[]): GroupMove {
  if (group === "closed") return { done: true };
  // Dropped among the proposals it is not one: it goes where nobody started it yet.
  if (group === "proposed") return moveTo("pending", columns);
  if (group === "blocked") return { awaits_owner: true };
  const has = (id: string) => columns.some((c) => c.id === id);
  if (group === "doing" && has("doing")) return { status: "doing", awaits_owner: false };
  if (group === "review" && has("review")) return { status: "review", awaits_owner: false };
  // Pending: "to do" when the board has it, else the first column that is not in progress or review.
  const pending = has("todo") ? "todo" : columns.find((c) => c.id !== "doing" && c.id !== "review")?.id;
  return { status: pending ?? columns[0]?.id ?? "todo", awaits_owner: false };
}
