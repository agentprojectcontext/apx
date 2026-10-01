// The engine: every agent turn enters through `admit` (threads.send is its only public door), runs one at a time
// per thread from the durable queue (the runs table), and reports its end to whoever waits for it.
import type { Part, RunTrigger } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { type Origin, type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { Harnesses } from "../harness/index.ts";
import type { Log } from "../log.ts";
import { agentReply } from "../tools/agents.ts";
import type { Tool } from "../tools/types.ts";
import type { Display } from "./display.ts";
import { recoverInterrupted } from "./recovery.ts";
import { runTurn } from "./turn.ts";

export const RUN_DEADLINE_MS = 6 * 60_000;
export const A2A_DEADLINE_MS = 10 * 60_000;
export const MAX_ACTIVE_DELEGATIONS = 3;

export type Admit = {
  thread_id: string;
  agent_id: string;
  trigger: RunTrigger;
  origin: Origin;
  text: string;
  parent_run_id?: string | undefined;
  depth?: number;
  deadlineMs?: number;
};

export function createEngine(deps: { store: Store; harnesses: Harnesses; tools: Tool[]; log: Log }) {
  const { store, log } = deps;
  const busy = new Set<string>();
  const running = new Set<Promise<void>>();
  const controllers = new Map<string, AbortController>();
  /** Delegations whose caller is still waiting inside its turn (run id → resolve). */
  const inline = new Map<string, (run: RunRecord) => void>();
  let stopping = false;
  /** Answers still being written, by run: updates to them must go through their display, not around it. */
  const live = new Map<string, Display>();
  /** runs.wait callers. */
  const waiters = new Map<string, Set<(run: RunRecord) => void>>();

  function admit(a: Admit): RunRecord {
    const run = store.runs.create({
      thread_id: a.thread_id,
      agent_id: a.agent_id,
      trigger: a.trigger,
      input: { origin: a.origin, text: a.text },
      parent_run_id: a.parent_run_id,
      depth: a.depth ?? 0,
      deadline_at: new Date(Date.now() + (a.deadlineMs ?? RUN_DEADLINE_MS)).toISOString(),
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
        if (!stopping) kick(threadId);
      });
    running.add(p);
  }

  async function execute(run: RunRecord): Promise<void> {
    const ac = new AbortController();
    controllers.set(run.id, ac);
    // A restart re-runs queued work with a fresh deadline: the clock started when the run could actually work.
    const timer = setTimeout(() => ac.abort(new Error("deadline")), deadlineOf(run));
    try {
      ended(await runTurn({ ...deps, delegate }, run, ac.signal));
    } finally {
      clearTimeout(timer);
      controllers.delete(run.id);
      live.delete(run.id);
    }
  }

  const deadlineOf = (run: RunRecord) => (run.trigger === "a2a" ? A2A_DEADLINE_MS : RUN_DEADLINE_MS);

  /** A run reached its end: wake its waiters and, for a delegated run, tell the agent that asked. */
  function ended(run: RunRecord): void {
    for (const w of waiters.get(run.id) ?? []) w(run);
    waiters.delete(run.id);
    if (!run.parent_run_id) return;
    const parent = store.runs.get(run.parent_run_id);
    if (!parent) return;
    const answer = answerOf(run);
    settleCard(parent, run, answer);
    const waiting = inline.get(run.id);
    if (waiting) {
      waiting(run);
      return;
    }
    // Nobody is waiting in a turn (the caller moved on, or the core restarted): the result comes back as a new,
    // durable input on the caller's thread. A cascade cancel is the owner's decision and wakes nobody.
    if (run.state === "canceled") return;
    const agent = store.agents.get(run.agent_id);
    admit({
      thread_id: parent.thread_id,
      agent_id: parent.agent_id,
      trigger: "a2a_result",
      origin: {
        kind: "delegation_result",
        agent_id: run.agent_id,
        name: agent?.name ?? run.agent_id,
        thread_id: run.thread_id,
        run_id: run.id,
        state: run.state,
      },
      text: answer,
      depth: parent.depth,
    });
  }

  function answerOf(run: RunRecord): string {
    const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
    const text = msg?.parts.find((p): p is Extract<Part, { type: "text" }> => p.type === "text")?.text;
    return text ?? run.error ?? `(${run.state}, no answer)`;
  }

  /** Updates the sub-thread card in the caller's answer. */
  function settleCard(parent: RunRecord, child: RunRecord, answer: string): void {
    const match = (p: Part) => p.type === "subthread" && p.thread_id === child.thread_id;
    const display = live.get(parent.id);
    const shown = display?.message.parts.find(match);
    if (display && shown?.type === "subthread") {
      display.upsert(match, { ...shown, state: child.state, summary: answer.slice(0, 240) });
      return;
    }
    const msg = parent.message_id ? store.messages.get(parent.message_id) : undefined;
    if (!msg) return;
    const index = msg.parts.findIndex((p) => p.type === "subthread" && p.thread_id === child.thread_id);
    const card = msg.parts[index];
    if (card?.type !== "subthread") return;
    const parts = [...msg.parts];
    parts[index] = { ...card, state: child.state, summary: answer.slice(0, 240) };
    store.messages.setPart({ ...msg, parts }, index);
  }

  /** Agents already involved from the top thread down to `threadId`, to refuse A→B→A cycles. */
  function chainAgents(threadId: string): string[] {
    const ids: string[] = [];
    let t = store.threads.get(threadId);
    for (let hops = 0; t && hops < 10; hops++) {
      ids.push(...t.agent_ids);
      t = t.parent_id ? store.threads.get(t.parent_id) : undefined;
    }
    return ids;
  }

  /**
   * The one way an agent asks another: a sub-thread with a durable run. Waits up to `waitMs` inside the caller's
   * turn; after that the child goes on and its result comes back to the caller's thread as a new input.
   */
  async function delegate(
    from: { run: RunRecord; agent: AgentRecord; display: Display },
    to: AgentRecord,
    task: string,
    waitMs: number,
  ): Promise<string> {
    const parentThread = store.threads.get(from.run.thread_id);
    if (!parentThread) return "refused: the thread is gone";
    if (chainAgents(parentThread.id).includes(to.id))
      return `refused: ${to.name} is already part of this delegation chain (cycle).`;
    if (store.runs.activeDelegations(parentThread.id) >= MAX_ACTIVE_DELEGATIONS)
      return `refused: ${MAX_ACTIVE_DELEGATIONS} delegations are already running from this thread; wait for their results.`;
    live.set(from.run.id, from.display);
    const sub = store.threads.create({
      kind: "a2a",
      title: `${from.agent.name} → ${to.name}: ${task.slice(0, 60)}`,
      agent_ids: [to.id, from.agent.id],
      project_id: parentThread.project_id,
      parent_id: parentThread.id,
    });
    store.messages.add({
      thread_id: sub.id,
      author: { kind: "agent", id: from.agent.id },
      parts: [{ type: "text", text: task }],
    });
    from.display.upsert((p) => p.type === "subthread" && p.thread_id === sub.id, {
      type: "subthread",
      thread_id: sub.id,
      agent_id: to.id,
      title: task.slice(0, 120),
      state: "working",
    });
    let resolveDone: (run: RunRecord) => void = () => {};
    const done = new Promise<RunRecord>((r) => {
      resolveDone = r;
    });
    const child = store.runs.create({
      thread_id: sub.id,
      agent_id: to.id,
      trigger: "a2a",
      input: {
        origin: {
          kind: "agent",
          id: from.agent.id,
          name: from.agent.name,
          thread_id: parentThread.id,
          run_id: from.run.id,
        },
        text: task,
      },
      parent_run_id: from.run.id,
      depth: from.run.depth + 1,
      deadline_at: new Date(Date.now() + A2A_DEADLINE_MS).toISOString(),
    });
    inline.set(child.id, resolveDone);
    kick(sub.id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const quick = await Promise.race([
      done,
      new Promise<undefined>((r) => {
        timer = setTimeout(() => r(undefined), waitMs);
      }),
    ]);
    clearTimeout(timer);
    inline.delete(child.id);
    if (quick) return agentReply(to.name, answerOf(quick));
    return `${to.name} keeps working in a sub-thread. You will get the result in a new turn: do not wait or ask for its status; tell the owner and go on.`;
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
    for (const r of store.runs.list(threadId, 5)) {
      const ac = controllers.get(r.id);
      if (ac && !ac.signal.aborted) {
        ac.abort(new Error("canceled by the owner"));
        n++;
      }
    }
    for (const child of store.threads.children(threadId)) n += cancel(child);
    if (n && !busy.has(threadId)) store.threads.patch(threadId, { state: "canceled" });
    return n;
  }

  return {
    admit,
    cancel,
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
      for (const ac of controllers.values()) ac.abort(new Error("APX is shutting down"));
      await Promise.allSettled([...running]);
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
