import type { Task } from "@apx/protocol";
import type { InputRecord } from "./inputs.ts";
import { runsOnComputer } from "./runs.ts";
import type { Store } from "./store.ts";
import type { ThreadContext } from "./threads.ts";

type WorkRef = Pick<InputRecord, "thread_id" | "agent_id" | "run_id">;

function taskOf(store: Store, input: WorkRef): Task | undefined {
  const thread = store.threads.get(input.thread_id);
  const task = thread?.task_id ? store.tasks.get(thread.task_id) : undefined;
  const context = store.threads.context(input.thread_id);
  const run = store.runs.get(input.run_id);
  const origin = run?.input?.origin;
  if (
    task?.state !== "open" ||
    task.proposed ||
    !origin ||
    run?.agent_id !== input.agent_id ||
    run.thread_id !== input.thread_id ||
    !runsOnComputer(origin) ||
    task.assignee !== input.agent_id ||
    thread?.kind !== "loose" ||
    thread.agent_ids[0] !== input.agent_id ||
    thread.project_id !== task.project_id ||
    context.client ||
    context.room ||
    context.consult
  )
    return undefined;
  return task;
}

function boundary(store: Store, task: Task): string {
  const events = store.tasks.events(task.id);
  const assignment = events.findLast((event) => typeof event.data.assignment_id === "string");
  const cycle = events.filter((event) => typeof event.data.state === "string").length;
  return `${assignment?.data.assignment_id ?? ""}:${cycle}`;
}

export function taskInputBoundary(store: Store, work: WorkRef): string | undefined {
  const task = taskOf(store, work);
  return task ? `${task.id}:${boundary(store, task)}` : undefined;
}

export function taskInputIsCurrent(store: Store, input: InputRecord): boolean {
  const binding = store.threads.context(input.thread_id).task_inputs?.[input.id];
  if (!binding) return true;
  const task = taskOf(store, input);
  return Boolean(task && task.id === binding.task && boundary(store, task) === binding.assignment);
}

function waitOf(store: Store, task: Task): NonNullable<ThreadContext["task_input_wait"]> {
  const prior = store.threads.context(task.thread_id).task_input_wait;
  const assignment = boundary(store, task);
  return prior?.assignment === assignment && prior ? prior : { inputs: [], manual: task.awaits_owner, assignment };
}

/** Called in the transaction that creates a blocking card, never for an optional question. */
export function awaitTaskInput(store: Store, input: InputRecord): void {
  const task = taskOf(store, input);
  if (!task) return;
  const prior = waitOf(store, task);
  const inputs = [...new Set([...prior.inputs, input.id])];
  store.threads.mergeContext(task.thread_id, { task_input_wait: { ...prior, inputs } });
  const bindings = store.threads.context(input.thread_id).task_inputs ?? {};
  store.threads.mergeContext(input.thread_id, {
    task_inputs: { ...bindings, [input.id]: { task: task.id, assignment: boundary(store, task) } },
  });
  if (!task.awaits_owner) store.tasks.change(task.id, { awaits_owner: true }, "system");
}

/** The response removes only its own wait; it cannot settle a separate blocker or finish a task. */
export function settleTaskInput(store: Store, input: InputRecord): void {
  if (input.state === "pending") return;
  const current = taskInputIsCurrent(store, input);
  const thread = store.threads.get(input.thread_id);
  const task = thread?.task_id ? store.tasks.get(thread.task_id) : undefined;
  if (!task) return;
  const prior = store.threads.context(task.thread_id).task_input_wait;
  if (!prior?.inputs.includes(input.id)) return;
  const inputs = prior.inputs.filter((id) => id !== input.id);
  const eligible = taskOf(store, input);
  const sameAssignment = prior.assignment === boundary(store, task);
  const manual = prior.manual || !eligible || !sameAssignment || !current;
  store.threads.mergeContext(task.thread_id, { task_input_wait: { ...prior, inputs, manual } });
  if (eligible && !inputs.length && !manual && !prior.comment && task.awaits_owner)
    store.tasks.change(task.id, { awaits_owner: false }, "system");
}

/** Remove the durable answer outbox entry only after delivery or cancellation. */
export function finishTaskInput(store: Store, input: InputRecord): void {
  const bindings = { ...store.threads.context(input.thread_id).task_inputs };
  if (!bindings[input.id]) return;
  delete bindings[input.id];
  store.threads.mergeContext(input.thread_id, { task_inputs: bindings });
}

/** Manual task edits cannot accidentally erase another outstanding native question. */
export function manualTaskWait(store: Store, task: Task, manual: boolean): boolean {
  const prior = waitOf(store, task);
  const inputs = prior.inputs.filter((id) => {
    const input = store.inputs.get(id);
    return input?.state === "pending" && taskOf(store, input)?.id === task.id && taskInputIsCurrent(store, input);
  });
  const comment = manual ? prior.comment : false;
  store.threads.mergeContext(task.thread_id, { task_input_wait: { ...prior, inputs, manual, comment } });
  return manual || inputs.length > 0 || Boolean(comment);
}

/** A reply to a task's mention acknowledges that question, not an unrelated manual hold. */
export function commentTaskWait(store: Store, task: Task, comment: boolean): boolean {
  const prior = waitOf(store, task);
  store.threads.mergeContext(task.thread_id, { task_input_wait: { ...prior, comment } });
  return prior.manual || prior.inputs.length > 0 || comment;
}
