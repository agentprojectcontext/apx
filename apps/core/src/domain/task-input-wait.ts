import type { Task } from "@apx/protocol";
import type { InputRecord } from "./inputs.ts";
import { runsOnComputer } from "./runs.ts";
import type { Store } from "./store.ts";

function taskOf(store: Store, input: InputRecord): Task | undefined {
  const thread = store.threads.get(input.thread_id);
  const task = thread?.task_id ? store.tasks.get(thread.task_id) : undefined;
  const context = store.threads.context(input.thread_id);
  const origin = store.runs.get(input.run_id)?.input?.origin;
  if (
    task?.state !== "open" ||
    task.proposed ||
    !origin ||
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

/** Called in the transaction that creates a blocking card, never for an optional question. */
export function awaitTaskInput(store: Store, input: InputRecord): void {
  const task = taskOf(store, input);
  if (!task) return;
  const prior = store.threads.context(task.thread_id).task_input_wait;
  const inputs = [...new Set([...(prior?.inputs ?? []), input.id])];
  store.threads.mergeContext(task.thread_id, {
    task_input_wait: { ...prior, inputs, manual: prior?.manual ?? task.awaits_owner },
  });
  if (!task.awaits_owner) store.tasks.change(task.id, { awaits_owner: true }, "system");
}

/** The response removes only its own wait; it cannot settle a separate blocker or finish a task. */
export function settleTaskInput(store: Store, input: InputRecord): void {
  if (input.state === "pending") return;
  const thread = store.threads.get(input.thread_id);
  const task = thread?.task_id ? store.tasks.get(thread.task_id) : undefined;
  if (!task) return;
  const prior = store.threads.context(task.thread_id).task_input_wait;
  if (!prior?.inputs.includes(input.id)) return;
  const inputs = prior.inputs.filter((id) => id !== input.id);
  const eligible = taskOf(store, input);
  const manual = prior.manual || !eligible;
  store.threads.mergeContext(task.thread_id, { task_input_wait: { ...prior, inputs, manual } });
  if (eligible && !inputs.length && !manual && !prior.comment && task.awaits_owner)
    store.tasks.change(task.id, { awaits_owner: false }, "system");
}

/** Manual task edits cannot accidentally erase another outstanding native question. */
export function manualTaskWait(store: Store, task: Task, manual: boolean): boolean {
  const prior = store.threads.context(task.thread_id).task_input_wait;
  const inputs = (prior?.inputs ?? []).filter((id) => {
    const input = store.inputs.get(id);
    return input?.state === "pending" && taskOf(store, input)?.id === task.id;
  });
  const comment = manual ? prior?.comment : false;
  store.threads.mergeContext(task.thread_id, { task_input_wait: { inputs, manual, comment } });
  return manual || inputs.length > 0 || Boolean(comment);
}

/** A reply to a task's mention acknowledges that question, not an unrelated manual hold. */
export function commentTaskWait(store: Store, task: Task, comment: boolean): boolean {
  const prior = store.threads.context(task.thread_id).task_input_wait ?? { inputs: [], manual: task.awaits_owner };
  store.threads.mergeContext(task.thread_id, { task_input_wait: { ...prior, comment } });
  return prior.manual || prior.inputs.length > 0 || comment;
}
