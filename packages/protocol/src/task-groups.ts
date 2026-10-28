// Where a task sits in the owner's task list, on every app: what needs the owner first (a question, or a review that
// is theirs), then what is moving, what waits, what an agent reviews, and the closed ones (DECISIONS.md#d-124,
// DECISIONS.md#d-129). Pure and zod-free, so the panel and the phone load it without the schema registry.
export type TaskGroupId = "proposed" | "doing" | "pending" | "review" | "blocked" | "closed";
export const TASK_GROUP_ORDER: readonly TaskGroupId[] = ["proposed", "blocked", "doing", "pending", "review", "closed"];

/** What grouping reads of a task: the phone keeps its own looser copy of the type. */
type Grouped = {
  state: string;
  status: string;
  thread_id: string;
  proposed?: boolean | undefined;
  awaits_owner?: boolean | undefined;
  reviewer?: string | null | undefined;
};

/**
 * What needs the owner wins over every column ("blocked": a question for them, or a review with no agent to do it);
 * then a task whose thread has a turn running counts as in progress whatever its column; `review` is an agent's review;
 * any other open column (backlog, to do, the owner's own) is pending.
 */
export function taskGroupOf(task: Grouped, running: ReadonlySet<string>): TaskGroupId {
  if (task.state !== "open") return "closed";
  // An agent's proposal: nothing starts until the owner accepts it.
  if (task.proposed) return "proposed";
  if (task.awaits_owner || (task.status === "review" && !task.reviewer)) return "blocked";
  if (task.status === "doing" || running.has(task.thread_id)) return "doing";
  if (task.status === "review") return "review";
  return "pending";
}
