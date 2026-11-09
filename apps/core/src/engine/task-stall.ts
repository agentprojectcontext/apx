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

type Stall = { task: Task; thread: Thread; last: RunRecord; ids: string[] };

/** The latest finished turn in these threads, or undefined when one is still running, queued or asking the owner. */
function lastTurn(store: Store, ids: string[]): RunRecord | undefined {
  if (store.threads.busy(ids) || ids.some((id) => store.inputs.pending(id).length)) return undefined;
  return ids
    .flatMap((id) => store.runs.list(id, 1))
    .filter((r) => r.ended_at)
    .sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))[0];
}

/** How many tasks in progress one check looks at, and how many agents it asks to go on (DECISIONS.md#d-206). */
export const STALL_PAGE = 100;
export const STALL_AT_ONCE = 3;
/** Where the last check stopped: the next one goes on from there, so every task in progress gets its turn. */
const STALL_CURSOR = "task_stall_after";

/**
 * A task in progress whose agent's chats went quiet: not waiting for the owner, on a subtask or on the breaker, and
 * stopped neither by the owner nor by a provider's limit.
 */
function stalledTask(store: Store, id: string, now: Date, held: ReadonlySet<string>): Stall | undefined {
  const task = store.tasks.get(id);
  const agent = task?.assignee;
  if (!task || !agent || held.has(task.id)) return undefined;
  const thread = store.threads.byTask(task.id).findLast((t) => t.agent_ids[0] === agent);
  if (!thread || trip(store, thread.id) || agentTrip(store, thread.id, agent)) return undefined;
  const ids = [task.thread_id, ...store.threads.family(thread.id)];
  const last = lastTurn(store, ids);
  const quiet = last?.ended_at ? now.getTime() - Date.parse(last.ended_at) : 0;
  if (!last || last.state === "canceled" || last.end_reason === "provider_limit") return undefined;
  if (quiet < STALL_AFTER_MS || quiet > STALL_WITHIN_MS) return undefined;
  return { task, thread, last, ids };
}

/**
 * The next tasks in progress after the saved cursor, wrapping once to the start: at most a page, so a large office is
 * looked at over several checks instead of only its most recently active tasks.
 */
function nextInProgress(store: Store): { ids: string[]; save: (upTo: string) => void } {
  const after = store.settings.get(STALL_CURSOR) ?? "";
  const ids = store.taskLanes.inProgress(after, STALL_PAGE);
  if (after && ids.length < STALL_PAGE)
    for (const id of store.taskLanes.inProgress("", STALL_PAGE - ids.length)) if (id <= after) ids.push(id);
  return {
    ids,
    // Past the end, the next check starts over.
    save: (upTo) => store.settings.set(STALL_CURSOR, upTo === ids.at(-1) && ids.length < STALL_PAGE ? "" : upTo),
  };
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
  const held = new Set(
    store.threads.holding().flatMap((id) => (store.threads.context(id).held ?? []).map((h) => h.task)),
  );
  const { ids, save } = nextInProgress(store);
  let upTo = "";
  for (const id of ids) {
    // The rest wait for the next check, from here: a backlog never starts many agents at once.
    if (revived >= STALL_AT_ONCE) break;
    upTo = id;
    const stalled = stalledTask(store, id, now, held);
    if (!stalled) continue;
    const { task, thread, last, ids: chats } = stalled;
    const stall = store.threads.context(thread.id).stall;
    if (stall && !ownerWroteSince(store, chats, stall.revived_at)) {
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
  if (upTo) save(upTo);
  return { revived, told };
}
