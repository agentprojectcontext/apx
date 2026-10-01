// The engine: every agent turn enters through `admit` (threads.send is its public door), runs one at a time per
// thread from the durable queue (the runs table), and reports its end to whoever waits for it.
// See DECISIONS.md#d-009
import type { RunTrigger } from "@apx/protocol";
import { type Origin, type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { Harnesses } from "../harness/index.ts";
import type { Log } from "../log.ts";
import type { Tool } from "../tools/types.ts";
import { A2A_DEADLINE_MS, createDelegations } from "./delegation.ts";
import type { Display } from "./display.ts";
import { recoverInterrupted } from "./recovery.ts";
import { runTurn } from "./turn.ts";

export const RUN_DEADLINE_MS = 6 * 60_000;

export type Admit = {
  thread_id: string;
  agent_id: string;
  trigger: RunTrigger;
  origin: Origin;
  text: string;
  depth?: number;
};

export function createEngine(deps: { store: Store; harnesses: Harnesses; tools: Tool[]; log: Log }) {
  const { store, log } = deps;
  const busy = new Set<string>();
  const running = new Set<Promise<void>>();
  /** Running turns: run id → its abort controller and thread. */
  const active = new Map<string, { ac: AbortController; thread: string }>();
  const live = new Map<string, Display>();
  const waiters = new Map<string, Set<(run: RunRecord) => void>>();
  let stopping = false;

  const delegations = createDelegations({
    store,
    kick,
    live,
    deliver: (parent, child, answer) => {
      const agent = store.agents.get(child.agent_id);
      admit({
        thread_id: parent.thread_id,
        agent_id: parent.agent_id,
        trigger: "a2a_result",
        origin: {
          kind: "delegation_result",
          agent_id: child.agent_id,
          name: agent?.name ?? child.agent_id,
          thread_id: child.thread_id,
          run_id: child.id,
          state: child.state,
        },
        text: answer,
        depth: parent.depth,
      });
    },
  });

  function admit(a: Admit): RunRecord {
    const run = store.runs.create({
      thread_id: a.thread_id,
      agent_id: a.agent_id,
      trigger: a.trigger,
      input: { origin: a.origin, text: a.text },
      depth: a.depth ?? 0,
      deadline_at: new Date(Date.now() + RUN_DEADLINE_MS).toISOString(),
    });
    if (store.threads.get(a.thread_id)?.state !== "working") store.threads.patch(a.thread_id, { state: "submitted" });
    // After the caller's transaction commits: the turn must never run on a row that could still roll back.
    queueMicrotask(() => kick(a.thread_id));
    return run;
  }

  /** Starts the thread's next queued run unless one is already running. */
  function kick(threadId: string): void {
    if (stopping || busy.has(threadId)) return;
    const next = store.runs.nextQueued(threadId);
    if (!next) return;
    busy.add(threadId);
    const p: Promise<void> = execute(next)
      .catch((err) => log.error({ run: next.id, err: String(err) }, "turn crashed"))
      .finally(() => {
        running.delete(p);
        busy.delete(threadId);
        kick(threadId);
      });
    running.add(p);
  }

  async function execute(run: RunRecord): Promise<void> {
    const ac = new AbortController();
    active.set(run.id, { ac, thread: run.thread_id });
    // A restart re-runs queued work with a fresh deadline: the clock starts when the run can actually work.
    const timer = setTimeout(
      () => ac.abort(new Error("deadline")),
      run.trigger === "a2a" ? A2A_DEADLINE_MS : RUN_DEADLINE_MS,
    );
    try {
      ended(await runTurn({ ...deps, delegate: delegations.delegate }, run, ac.signal));
    } finally {
      clearTimeout(timer);
      active.delete(run.id);
      live.delete(run.id);
      delegations.callerEnded(run.id);
    }
  }

  function ended(run: RunRecord): void {
    for (const w of waiters.get(run.id) ?? []) w(run);
    waiters.delete(run.id);
    delegations.childEnded(run);
  }

  /** Aborts the thread's running turn and cancels the sub-threads that turn opened. */
  function stopRunning(threadId: string): number {
    let n = 0;
    for (const [runId, a] of active) {
      if (a.thread !== threadId || a.ac.signal.aborted) continue;
      a.ac.abort(new Error("canceled by the owner"));
      n++;
      for (const child of store.runs.children(runId)) n += cancel(child.thread_id);
    }
    return n;
  }

  /** Cancels the thread's queued and running turns and, recursively, its sub-threads'. */
  function cancel(threadId: string): number {
    let n = 0;
    for (const id of store.runs.queuedIds(threadId)) {
      const r = store.runs.get(id);
      if (r) {
        ended(store.runs.setState(r, "canceled", "canceled before it started"));
        n++;
      }
    }
    n += stopRunning(threadId);
    for (const child of store.threads.children(threadId)) n += cancel(child);
    if (n && !busy.has(threadId)) store.threads.patch(threadId, { state: "canceled" });
    return n;
  }

  return {
    admit,
    cancel,
    /** Stops only the turn in progress (and what it delegated); queued inputs still run. */
    interrupt: stopRunning,
    /** Resolves when the run ends, or after `timeoutMs` with the run as it is then. */
    wait(runId: string, timeoutMs: number): Promise<RunRecord | undefined> {
      const cur = store.runs.get(runId);
      if (!cur || TERMINAL.has(cur.state)) return Promise.resolve(cur);
      return new Promise((resolve) => {
        const set = waiters.get(runId) ?? new Set();
        const done = (r: RunRecord) => {
          clearTimeout(timer);
          resolve(r);
        };
        const timer = setTimeout(() => {
          set.delete(done);
          resolve(store.runs.get(runId));
        }, timeoutMs);
        set.add(done);
        waiters.set(runId, set);
      });
    },
    /** Boot: close what a restart interrupted, then pick the durable queue back up. */
    start(): void {
      const interrupted = recoverInterrupted(store);
      if (interrupted.length) log.warn({ runs: interrupted.length }, "closed runs interrupted by the last restart");
      for (const r of interrupted) ended(r);
      for (const threadId of store.runs.queuedThreads()) kick(threadId);
    },
    /** Shutdown: stops every running turn (each ends as failed, saying why) and waits for them to finish writing. */
    async stop(): Promise<void> {
      stopping = true;
      for (const a of active.values()) a.ac.abort(new Error("APX is shutting down"));
      await Promise.allSettled([...running]);
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
