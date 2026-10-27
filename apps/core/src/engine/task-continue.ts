// A task turn that ends with the task still in progress goes on at once, part by part, instead of waiting for the
// stall watch: an agent that ran out of steps or stopped at "I'll continue" picks up where it was (DECISIONS.md#d-162).
// It stops when a part made no progress, after MAX_AUTO_PARTS in a row, or when something else is to come.
import type { Origin, RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { agentTrip, trip } from "./breaker.ts";
import type { AdmitFn } from "./engine.ts";
import { MAX_AUTO_PARTS, stalled } from "./progress.ts";

type Continue = Extract<Origin, { kind: "task_continue" }>;

/** The continuations that led to `run` in its chat, newest first, back to the turn that started this stretch. */
function parts(store: Store, threadId: string): RunRecord[] {
  const out: RunRecord[] = [];
  for (const r of store.runs.list(threadId, MAX_AUTO_PARTS + 2)) {
    if (r.input?.origin.kind !== "task_continue") break;
    out.push(r);
  }
  return out;
}

/** Starts the next part of `run`'s task when its turn ended with the task in progress and nothing else to come. */
export function continueTask(store: Store, admit: AdmitFn, run: RunRecord): RunRecord | undefined {
  // A stopped turn is the owner's word; a failed one is the provider's or APX's, told on its own.
  if (run.state !== "completed") return undefined;
  const thread = store.threads.get(run.thread_id);
  const task = thread?.task_id ? store.tasks.get(thread.task_id) : undefined;
  if (!thread || !task || thread.agent_ids[0] !== run.agent_id || task.assignee !== run.agent_id) return undefined;
  // In review it is someone else's turn; otherwise the agent working it is on it, whatever column it sits in.
  if (task.state !== "open" || task.status === "review" || task.awaits_owner || task.proposed) return undefined;
  // Something else comes back here on its own: a subtask's close, a helper's result, a command's end, the owner.
  if (
    store.tasks.list({ state: "open", parent: task.id, limit: 1 }).length ||
    store.threads.busy([thread.id]) ||
    store.inputs.pending(thread.id).length ||
    store.runs.activeDelegations(thread.id) > 0 ||
    store.runs.held(thread.id).length ||
    store.jobs.running().some((j) => j.thread_id === thread.id && j.background) ||
    trip(store, thread.id) ||
    agentTrip(store, thread.id, run.agent_id)
  )
    return undefined;
  const done = parts(store, thread.id);
  if (done.length >= MAX_AUTO_PARTS) return undefined;
  // A part after the first must have got somewhere; the first one may have stopped early, which is why it goes on.
  if (done.length && stalled(store.runs.steps(run.id), done[1] ? store.runs.steps(done[1].id) : [])) return undefined;
  const origin: Continue = {
    kind: "task_continue",
    task_id: task.id,
    title: task.title.slice(0, 120),
    part: done.length + 2,
    of: MAX_AUTO_PARTS + 1,
  };
  return admit({
    thread_id: thread.id,
    agent_id: run.agent_id,
    trigger: "system",
    origin,
    text: `${task.title}: go on`,
    reply_to: run.input?.reply_to,
  });
}
