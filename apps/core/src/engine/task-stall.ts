// A task an agent was working on can stop with nobody on it: a result nobody picked up, a turn that ended without
// closing it or saying what it waits for. The office clock finds these from the store alone (no model call), asks the
// agent once to go on, and tells the owner if it stops again.
import type { Task, Thread } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { noticeTaskStalled } from "../domain/task-attention.ts";
import { agentTrip, trip } from "./breaker.ts";
import type { AdmitFn } from "./engine.ts";
import { stalledWords } from "./owner-words.ts";

/** How long after its last turn ended, with nothing running, a task counts as stalled. */
export const STALL_AFTER_MS = 20 * 60_000;
/** Only recent stops: a task left open for days is the owner's backlog, not a stall. */
const STALL_WITHIN_MS = 24 * 3600_000;

export type Stall = { task: Task; thread: Thread; last: RunRecord; ids: string[] };

/** The latest finished turn in these threads, or undefined when one is still running, queued or asking the owner. */
function lastTurn(store: Store, ids: string[]): RunRecord | undefined {
  if (store.threads.busy(ids) || ids.some((id) => store.inputs.pending(id).length)) return undefined;
  return ids
    .flatMap((id) => store.runs.list(id, 1))
    .filter((r) => r.ended_at)
    .sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))[0];
}

/**
 * Tasks in progress whose agent's chats went quiet: not waiting for the owner, on a subtask or on the breaker, and
 * stopped neither by the owner nor by a provider's limit.
 */
export function stalledTasks(store: Store, now: Date): Stall[] {
  const held = new Set(
    store.threads.holding().flatMap((id) => (store.threads.context(id).held ?? []).map((h) => h.task)),
  );
  const out: Stall[] = [];
  for (const task of store.tasks.list({ state: "open", limit: 500 })) {
    const agent = task.assignee;
    if (
      task.status !== "doing" ||
      task.awaits_owner ||
      task.proposed ||
      held.has(task.id) ||
      !agent ||
      !store.agents.get(agent)
    )
      continue;
    // A subtask still open is what it waits on; its close reports back on its own.
    if (store.tasks.list({ state: "open", parent: task.id, limit: 1 }).length) continue;
    const thread = store.threads.byTask(task.id).findLast((t) => t.agent_ids[0] === agent);
    if (!thread || trip(store, thread.id) || agentTrip(store, thread.id, agent)) continue;
    const ids = [task.thread_id, ...store.threads.family(thread.id)];
    const last = lastTurn(store, ids);
    const quiet = last?.ended_at ? now.getTime() - Date.parse(last.ended_at) : 0;
    if (!last || last.state === "canceled" || last.end_reason === "provider_limit") continue;
    if (quiet < STALL_AFTER_MS || quiet > STALL_WITHIN_MS) continue;
    out.push({ task, thread, last, ids });
  }
  return out;
}

/** Whether the owner wrote in these chats since `at`: the agent may be asked to go on again after a new stop. */
const ownerWroteSince = (store: Store, ids: string[], at: string) =>
  ids.some((id) => store.runs.list(id, 20).some((r) => r.trigger === "user" && r.started_at > at));

/**
 * Asks each stalled task's agent to go on, once until the owner writes there again; a task that stops again meanwhile
 * goes to the owner's tray, once per stop.
 */
export function reviveStalled(store: Store, admit: AdmitFn, now: Date): { revived: number; told: number } {
  let revived = 0;
  let told = 0;
  for (const { task, thread, last, ids } of stalledTasks(store, now)) {
    const stall = store.threads.context(thread.id).stall;
    if (stall && !ownerWroteSince(store, ids, stall.revived_at)) {
      if (stall.told === last.id) continue;
      const agent = store.agents.get(task.assignee ?? "")?.name ?? task.assignee ?? "";
      noticeTaskStalled(store, task, thread.id, stalledWords(store, agent));
      store.threads.mergeContext(thread.id, { stall: { ...stall, told: last.id } });
      told++;
      continue;
    }
    store.messages.add({
      thread_id: thread.id,
      author: { kind: "system" },
      parts: [
        {
          type: "notice",
          level: "info",
          code: "task.stalled",
          text: "Nothing was running on this task: APX asked the agent to go on or say what it waits for.",
        },
      ],
    });
    // Not the owner's words: it starts no new budget window and releases nothing the breaker holds.
    admit({
      thread_id: thread.id,
      agent_id: task.assignee ?? "",
      trigger: "system",
      origin: { kind: "stalled_task", task_id: task.id, title: task.title },
      text: "",
      depth: last.depth,
    });
    store.threads.mergeContext(thread.id, { stall: { revived_at: now.toISOString() } });
    revived++;
  }
  return { revived, told };
}
