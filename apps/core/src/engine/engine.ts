// The engine: every agent turn enters through `admit` (threads.send is its public door), runs one at a time per
// thread from the durable queue (the runs table), and reports its end to whoever waits for it.
// See DECISIONS.md#d-009
import type { RunTrigger, Thread } from "@apx/protocol";
import { type Attachment, type Origin, type RunInput, type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { Canceled, DeadlineExceeded, Shutdown } from "../errors.ts";
import type { Harnesses } from "../harness/index.ts";
import { systemNote } from "../harness/native.ts";
import type { Log } from "../log.ts";
import { untrusted } from "../tools/result.ts";
import type { Tool } from "../tools/types.ts";
import { tripped } from "./breaker.ts";
import { createDelegations } from "./delegation.ts";
import type { Display } from "./display.ts";
import type { Hooks } from "./hooks.ts";
import { createInputs, type InputWaits } from "./inputs.ts";
import { createJobs } from "./jobs.ts";
import { A2A_DEADLINE_MS } from "./limits.ts";
import type { MemoryIndex } from "./memory-index.ts";
import type { ProfileRoot } from "./profiles.ts";
import { recoverInterrupted } from "./recovery.ts";
import type { SkillPicker } from "./skill-pick.ts";
import { runTurn, type ToolCall } from "./turn.ts";

export const RUN_DEADLINE_MS = 6 * 60_000;
/** Time a turn gets back after the owner answers, even if its clock had almost run out. */
const AFTER_ANSWER_MS = 60_000;

type Clock = { pause(): void; resume(): void; stop(): void };

/** A deadline that can be held (nested holds count): used while a turn waits for the owner. */
function pausableClock(ms: number, fire: () => void): Clock {
  let left = ms;
  let since = Date.now();
  let holds = 0;
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(fire, ms);
  return {
    pause() {
      if (holds++ > 0) return;
      clearTimeout(timer);
      timer = undefined;
      left -= Date.now() - since;
    },
    resume() {
      if (holds === 0 || --holds > 0) return;
      since = Date.now();
      timer = setTimeout(fire, Math.max(left, AFTER_ANSWER_MS));
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

/** A turn to run, as everything that starts one describes it. */
export type Admit = {
  thread_id: string;
  agent_id: string;
  trigger: RunTrigger;
  origin: Origin;
  text: string;
  /** Files and images the owner attached (the run's input keeps them). */
  attachments?: Attachment[];
  reply_to?: RunInput["reply_to"];
  depth?: number;
  /** A resumed delegated turn still reports to the original caller. */
  parent_run_id?: string | undefined;
  /** The turn a restart cut off, which this one picks back up. */
  resume_of?: string | undefined;
};

export type AdmitFn = (a: Admit) => RunRecord;

export function createEngine(deps: {
  store: Store;
  harnesses: Harnesses;
  tools: Tool[];
  log: Log;
  call: ToolCall;
  home: string;
  /** The port this core listens on (known once the server listens): commands reaching it are APX's own door. */
  apxPort: () => number;
  memory: MemoryIndex;
  /** Skills picked by meaning for each turn. */
  skills?: SkillPicker;
  /** Where profiles are found (APX's own and the owner's). */
  profileRoots?: readonly ProfileRoot[];
  /** This core's version and commit, for the agents' prompt. */
  build?: { version: string; code_sha: string };
  /** Extension points (a plugin's context for owner turns). */
  hooks?: Hooks;
  /** How long a turn waits for the owner's answer (tests shorten it). */
  inputWaits?: InputWaits;
  /** MCP servers' tools for a thread (its project's approved ones and the owner's). */
  mcpTools?: (thread: Thread) => Promise<Tool[]>;
  /** The MCP servers a thread may reach, by name, without starting them. */
  mcpServers?: (thread: Thread) => string[];
  /** Whether a connected node lends this capability now (a phone's location). */
  hasCap?: (cap: string) => boolean;
  /** Work on the thread once a run ended (title, compaction); never blocks the next run. */
  afterRun?: (run: RunRecord) => void;
}) {
  const { store, log } = deps;
  const busy = new Set<string>();
  const running = new Set<Promise<void>>();
  /** Running turns: run id → its abort controller, thread and deadline. */
  const active = new Map<string, { ac: AbortController; thread: string; clock: Clock }>();
  const live = new Map<string, Display>();
  /** Owner text steered into a running turn, not yet taken by its loop. */
  const steered = new Map<string, string[]>();
  const waiters = new Map<string, Set<(run: RunRecord) => void>>();
  let stopping = false;

  const delegations = createDelegations({
    store,
    kick,
    live,
    deliver: (parent, child, answer) => {
      const agent = store.agents.get(child.agent_id);
      const name = store.threads.context(child.thread_id).worker?.name ?? agent?.name ?? child.agent_id;
      const paused = tripped(store, parent.thread_id);
      if (paused) {
        // The result is kept for the caller's next turn (when the owner writes), and the owner sees why it stopped.
        store.modelLog.append(parent.thread_id, child.id, [
          systemNote(
            `A task you delegated to ${name} ended (${child.state}) while agents were paused:\n${untrusted("delegation_result", { from: name }, answer.slice(0, 4000))}`,
          ),
        ]);
        store.messages.add({
          thread_id: parent.thread_id,
          author: { kind: "system" },
          parts: [
            {
              type: "notice",
              level: "warn",
              code: "breaker.paused",
              text: `Paused: ${paused}. ${name} finished; write to continue.`,
            },
          ],
        });
        return;
      }
      admit({
        thread_id: parent.thread_id,
        agent_id: parent.agent_id,
        trigger: "a2a_result",
        origin: {
          kind: "delegation_result",
          agent_id: child.agent_id,
          name,
          thread_id: child.thread_id,
          run_id: child.id,
          state: child.state,
        },
        text: answer,
        depth: parent.depth,
        reply_to: parent.input?.reply_to,
      });
    },
  });

  const jobs = createJobs({ store, home: deps.home, log, admit: (a) => admit(a) });

  // The turn's clock stops while it waits for the owner: their time to answer is not the agent's time to work.
  const inputs = createInputs({
    store,
    admit: (a) => admit(a),
    hold: (runId) => {
      const clock = active.get(runId)?.clock;
      clock?.pause();
      return () => clock?.resume();
    },
    ...(deps.inputWaits ? { waits: deps.inputWaits } : {}),
  });

  function admit(a: Admit): RunRecord {
    const run = store.runs.create({
      thread_id: a.thread_id,
      agent_id: a.agent_id,
      trigger: a.trigger,
      input: {
        origin: a.origin,
        text: a.text,
        ...(a.attachments?.length ? { attachments: a.attachments } : {}),
        reply_to: a.reply_to !== undefined ? a.reply_to : (store.threads.context(a.thread_id).reply_to ?? null),
        ...(a.resume_of ? { resume_of: a.resume_of } : {}),
      },
      depth: a.depth ?? 0,
      parent_run_id: a.parent_run_id,
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
    // A restart re-runs queued work with a fresh deadline: the clock starts when the run can actually work.
    const clock = pausableClock(run.trigger === "a2a" ? A2A_DEADLINE_MS : RUN_DEADLINE_MS, () =>
      ac.abort(new DeadlineExceeded()),
    );
    active.set(run.id, { ac, thread: run.thread_id, clock });
    try {
      const takeSteered = () => {
        const texts = steered.get(run.id) ?? [];
        steered.set(run.id, []);
        return texts;
      };
      const done = await runTurn(
        { ...deps, inputs, jobs, takeSteered, delegate: delegations.delegate },
        run,
        ac.signal,
      );
      ended(done);
      // A turn APX's shutdown cut off is not over: the next boot closes and resumes it.
      if (TERMINAL.has(done.state)) deps.afterRun?.(done);
    } finally {
      clock.stop();
      active.delete(run.id);
      // Steered text the turn ended before taking is not lost: it runs next, as a normal message.
      for (const text of steered.get(run.id) ?? [])
        admit({ thread_id: run.thread_id, agent_id: run.agent_id, trigger: "user", origin: { kind: "user" }, text });
      steered.delete(run.id);
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
      a.ac.abort(new Canceled());
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
    /** Hands owner text to the thread's running turn when its loop can take it mid-turn (ours); else undefined. */
    steer(threadId: string, text: string): RunRecord | undefined {
      for (const [runId, a] of active) {
        if (a.thread !== threadId || a.ac.signal.aborted) continue;
        const run = store.runs.get(runId);
        if (run?.harness !== "native") return undefined;
        steered.set(runId, [...(steered.get(runId) ?? []), text]);
        return run;
      }
      return undefined;
    },
    /** The owner's answer to something an agent asked (runs.respond). */
    respond: inputs.respond,
    pending: inputs.pending,
    jobs,
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
      inputs.restore();
      jobs.reconcile();
      const interrupted = recoverInterrupted(store);
      if (interrupted.length) log.warn({ runs: interrupted.length }, "closed runs interrupted by the last restart");
      for (const { run, resume } of interrupted) {
        // The resumed turn settles the caller's card and reports to it; the cut one wakes nobody.
        if (!resume || !run.input) {
          ended(run);
          continue;
        }
        admit({
          thread_id: run.thread_id,
          agent_id: run.agent_id,
          trigger: run.trigger,
          origin: run.input.origin,
          text: run.input.text,
          ...(run.input.attachments ? { attachments: run.input.attachments } : {}),
          reply_to: run.input.reply_to ?? null,
          depth: run.depth,
          parent_run_id: run.parent_run_id,
          resume_of: run.id,
        });
      }
      for (const threadId of store.runs.queuedThreads()) kick(threadId);
    },
    /** Shutdown: stops every running turn (left open, so the next boot resumes it) and waits for them to finish writing. */
    async stop(): Promise<void> {
      stopping = true;
      for (const a of active.values()) a.ac.abort(new Shutdown());
      await Promise.allSettled([...running, jobs.stopAll()]);
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
