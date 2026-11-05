import type { Task, TaskEvent } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { taskReviewHandoff } from "../domain/tasks.ts";
import { type Transfer, type TransferPolicy, transferBudget } from "./task-transfer-budget.ts";

type Caller = { id: string; thread_id: string; run_id: string };

/** Owner follow-ups keep the current assignment's identity without creating a new authorization boundary. */
export function ownerTaskAssignment(store: Store, threadId: string, agentId: string) {
  const thread = store.threads.get(threadId);
  const task = thread?.task_id ? store.tasks.get(thread.task_id) : undefined;
  if (
    task?.state !== "open" ||
    task.proposed ||
    task.awaits_owner ||
    task.assignee !== agentId ||
    thread?.agent_ids[0] !== agentId ||
    thread.project_id !== task.project_id ||
    store.threads.context(threadId).client
  )
    return undefined;
  const assignment = store.tasks.events(task.id).findLast((event) => typeof event.data.assignment_id === "string");
  return typeof assignment?.data.assignment_id === "string"
    ? { task: task.id, id: assignment.data.assignment_id }
    : undefined;
}

function assignmentRun(store: Store, current: RunRecord, task: Task): RunRecord | undefined {
  let run: RunRecord | undefined = current;
  const seen = new Set<string>();
  while (run?.input && seen.size < 32 && !seen.has(run.id)) {
    seen.add(run.id);
    const origin = run.input.origin;
    let prior = run.input.resume_of ?? run.input.retry_of ?? run.input.continues;
    if (!prior && origin.kind === "task_continue") {
      if (run.trigger !== "system" || origin.task_id !== task.id) return undefined;
      prior = origin.from_run;
      if (!prior) return undefined;
    }
    if (!prior && origin.kind === "input_answer") {
      const answer = store.inputs.get(origin.input_id);
      if (!answer?.answered_at || answer.thread_id !== run.thread_id || answer.agent_id !== run.agent_id)
        return undefined;
      prior = answer.run_id;
    }
    if (!prior) return run;
    const previous = store.runs.get(prior);
    if (
      !previous ||
      previous.thread_id !== current.thread_id ||
      previous.agent_id !== current.agent_id ||
      previous.started_at > run.started_at
    )
      return undefined;
    run = previous;
  }
  return undefined;
}

function issuedAfter(store: Store, run: RunRecord, task: Task, assignment: TaskEvent): boolean {
  const root = assignmentRun(store, run, task);
  if (!root?.input || root.started_at < assignment.at) return false;
  const origin = root.input.origin;
  if (
    (origin.kind !== "user" && origin.kind !== "agent") ||
    typeof assignment.data.assignment_id !== "string" ||
    origin.task_assignment?.task !== task.id ||
    origin.task_assignment.id !== assignment.data.assignment_id
  )
    return false;
  return (
    (origin.kind === "user" && root.trigger === "user") ||
    (origin.kind === "agent" &&
      root.trigger === "a2a" &&
      origin.id === assignment.by &&
      origin.run_id === assignment.data.from_run &&
      origin.thread_id === assignment.data.from_thread)
  );
}

/** What the owner authorized: a rewrite by anyone, even in the handoff call itself, needs the owner again. */
const SCOPE = ["title", "description", "goal", "project_id"] as const;

/** A recorded owner assignment is an execution boundary, not another historical parent. */
export function assignmentProposalReason(
  store: Store,
  task: Task,
  caller: Caller,
  next: string,
  status?: string,
  changes?: Partial<Record<(typeof SCOPE)[number], unknown>>,
): TransferPolicy | { verified: false; reason: string } | undefined {
  const events = store.tasks.events(task.id);
  const anchor = events.findLastIndex(
    (e) => e.by === "owner" && (Object.hasOwn(e.data, "assignee") || e.data.proposed === false),
  );
  const authorization = events[anchor];
  const denied = { verified: false as const, reason: "its current task authorization cannot be verified" };
  if (!authorization) return undefined;
  const thread = store.threads.get(caller.thread_id);
  const run = store.runs.get(caller.run_id);
  if (
    task.state !== "open" ||
    task.proposed ||
    task.awaits_owner ||
    !thread ||
    thread.project_id !== task.project_id ||
    run?.thread_id !== thread.id ||
    run.agent_id !== caller.id ||
    run.ended_at ||
    store.threads.context(thread.id).client
  )
    return denied;

  if (authorization.at > run.started_at) return denied;
  // An agent setting the goal a task never had (D-187) fills it in; changing any other scope is a rewrite.
  const fillsGoal = (event: TaskEvent, i: number) =>
    event.by !== "owner" &&
    Object.keys(event.data).every((key) => key === "goal" || !SCOPE.includes(key as (typeof SCOPE)[number])) &&
    !events.slice(0, i).some((e) => typeof e.data.goal === "string" && e.data.goal.trim());
  if (
    events.some(
      (event, i) =>
        i > anchor &&
        ((SCOPE.some((key) => Object.hasOwn(event.data, key)) && !fillsGoal(event, i)) ||
          (event.by === "owner" && ["state", "awaits_owner"].some((key) => Object.hasOwn(event.data, key)))),
    )
  )
    return denied;
  const rewrites = SCOPE.filter((key) => changes?.[key] !== undefined);
  if (rewrites.length && !(rewrites.join() === "goal" && !task.goal)) return denied;
  const initial = events.slice(0, anchor + 1).findLast((e) => Object.hasOwn(e.data, "assignee"))?.data.assignee;
  if (typeof initial !== "string") return denied;
  if (events.slice(anchor + 1).some((event) => Object.hasOwn(event.data, "proposed"))) return denied;
  // Taking the owner's current chat into a task keeps the separate self-handoff checks and historical limit.
  if (
    task.assignee &&
    task.assignee !== caller.id &&
    next === caller.id &&
    run.trigger === "user" &&
    run.input?.origin.kind === "user"
  )
    return undefined;
  if (task.assignee !== caller.id) return denied;
  let latest = authorization;
  let previous = initial;
  const moves: Transfer[] = [];
  for (const event of events.slice(anchor + 1)) {
    if (!Object.hasOwn(event.data, "assignee") || event.data.assignee === previous) continue;
    const to = event.data.assignee;
    if (event.by !== previous || typeof to !== "string") return denied;
    const source = typeof event.data.from_run === "string" ? store.runs.get(event.data.from_run) : undefined;
    const sourceThread = source ? store.threads.get(source.thread_id) : undefined;
    if (
      !source ||
      source.agent_id !== previous ||
      source.thread_id !== event.data.from_thread ||
      !sourceThread ||
      sourceThread.project_id !== task.project_id ||
      source.started_at < authorization.at ||
      source.started_at > event.at ||
      !issuedAfter(store, source, task, latest) ||
      store.threads.context(source.thread_id).client
    )
      return denied;
    const review = taskReviewHandoff(event.data.review_handoff);
    if (Object.hasOwn(event.data, "review_handoff") && !review) return denied;
    moves.push({ from: previous, to, ...(review ? { review } : {}) });
    previous = to;
    latest = event;
  }
  if (previous !== caller.id) return denied;
  if (!issuedAfter(store, run, task, latest)) return denied;

  return transferBudget(initial, moves, { from: caller.id, to: next }, status === "review");
}
