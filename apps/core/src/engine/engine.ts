// The engine: every agent turn enters through `admit` (threads.send is its public door), runs one at a time per
// thread from the durable queue (the runs table), and reports its end to whoever waits for it.
// See DECISIONS.md#d-009

import type { RunTrigger, Thread } from "@apx/protocol";
import { type Attachment, type Origin, type RunInput, type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { Canceled, conflict, DeadlineExceeded, notFound, Shutdown, Superseded } from "../errors.ts";
import type { Harnesses } from "../harness/index.ts";
import type { Log } from "../log.ts";
import type { RuntimeHomes } from "../skills/runtimes.ts";
import type { Tool } from "../tools/types.ts";
import { agentTrip, trip } from "./breaker.ts";
import { frameInput } from "./context.ts";
import { createDelegations } from "./delegation.ts";
import type { Display } from "./display.ts";
import { createFanout, deliverResults } from "./fanout.ts";
import type { Hooks } from "./hooks.ts";
import { createInputs, type InputWaits } from "./inputs.ts";
import { createJobs } from "./jobs.ts";
import { A2A_CAP_MS, FANOUT_HOLD_MS } from "./limits.ts";
import type { MemoryIndex } from "./memory-index.ts";
import { relayEnded } from "./owner-relay.ts";
import type { Permissions } from "./permissions.ts";
import type { ProfileRoot } from "./profiles.ts";
import { recoverInterrupted } from "./recovery.ts";
import { droppedResult } from "./run-outcome.ts";
import type { SkillPicker } from "./skill-pick.ts";
import { ownerTaskAssignment } from "./task-assignment.ts";
import { OWNER_ADDS, runTurn, type ToolCall } from "./turn.ts";
import { askedIn, editInLine, lineOf, removeFromLine, reorderLine } from "./waiting.ts";

/**
 * A turn on our own loop ends after this long without progress (a token, a tool's result): a long browser or
 * computer session keeps going while it works, and its step limit bounds it. See DECISIONS.md#d-067
 */
export const RUN_DEADLINE_MS = 6 * 60_000;
/**
 * A session with an outside engine (Claude Code, Codex, an ACP agent) has no time limit while it works: it ends
 * only after this long without a single event from it. See DECISIONS.md#d-061
 */
export const ENGINE_IDLE_MS = 20 * 60_000;
/** Time a turn gets back after the owner answers, even if its clock had almost run out. */
const AFTER_ANSWER_MS = 60_000;
/** How often a working engine's moving deadline is written to its run (not on every streamed token). */
const DEADLINE_WRITE_MS = 60_000;

/** "6 minutes", "2 hours", "3 seconds": how long a limit is, for the reason a turn was stopped. */
function timeSpan(ms: number): string {
  const [n, unit] =
    ms >= 3600_000 && ms % 3600_000 === 0
      ? [ms / 3600_000, "hour"]
      : ms >= 60_000
        ? [Math.round(ms / 60_000), "minute"]
        : [Math.max(1, Math.round(ms / 1000)), "second"];
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

type Clock = { pause(): void; resume(): void; stop(): void; touch(): void; busy(): () => void };
/** `cap`: the most it may work in all, progress or not (a delegated run's). */
type Limit = { ms: number; engine: boolean; cap?: number | undefined };
export type RunTimers = {
  now(): number;
  after(ms: number, callback: () => void): () => void;
};
const wallRunTimers: RunTimers = {
  now: () => Date.now(),
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};
type IdleWindows = {
  engineIdleMs?: number | undefined;
  turnIdleMs?: number | undefined;
  a2aCapMs?: number | undefined;
};

/** Every turn stops after its idle window without progress; a delegated one also at its cap (DECISIONS.md#d-105). */
function runLimit(store: Store, threadId: string, trigger: string | undefined, w: IdleWindows): Limit {
  const cap = trigger === "a2a" ? (w.a2aCapMs ?? A2A_CAP_MS) : undefined;
  return store.threads.get(threadId)?.engine
    ? { ms: w.engineIdleMs ?? ENGINE_IDLE_MS, engine: true, cap }
    : { ms: w.turnIdleMs ?? RUN_DEADLINE_MS, engine: false, cap };
}

/**
 * A deadline that can be held (nested holds count): used while a turn waits for the owner. It starts over on every
 * sign of life (`touch`), reports its new end through `moved` and does not run out while work it waits on is in
 * progress (`busy`). The cap never starts over and counts only the time the turn was not held.
 */
function pausableClock(
  limit: Limit,
  fire: (capped: boolean) => void,
  moved: (at: number) => void = () => {},
  timers: RunTimers = wallRunTimers,
): Clock {
  let left = limit.ms;
  let since = timers.now();
  let capLeft = limit.cap ?? 0;
  let capSince = since;
  let holds = 0;
  let timer: (() => void) | undefined = timers.after(limit.ms, () => fire(false));
  let capTimer: (() => void) | undefined = limit.cap ? timers.after(limit.cap, () => fire(true)) : undefined;
  let written = since;
  /** Work in progress the turn waits on: no idle end meanwhile. */
  let working = 0;
  let stopped = false;
  const arm = (ms: number) => {
    timer?.();
    timer = working > 0 || stopped ? undefined : timers.after(ms, () => fire(false));
  };
  return {
    pause() {
      if (holds++ > 0) return;
      timer?.();
      capTimer?.();
      timer = undefined;
      capTimer = undefined;
      const now = timers.now();
      left -= now - since;
      capLeft -= now - capSince;
    },
    resume() {
      if (holds === 0 || --holds > 0) return;
      since = capSince = timers.now();
      arm(Math.max(left, AFTER_ANSWER_MS));
      if (limit.cap && !stopped) capTimer = timers.after(Math.max(capLeft, AFTER_ANSWER_MS), () => fire(true));
    },
    stop() {
      stopped = true;
      timer?.();
      capTimer?.();
    },
    touch() {
      if (holds > 0) return;
      const now = timers.now();
      since = now;
      left = limit.ms;
      arm(limit.ms);
      if (now - written < DEADLINE_WRITE_MS) return;
      written = now;
      moved(now + limit.ms);
    },
    busy() {
      working++;
      timer?.();
      timer = undefined;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        // A held clock resumes with a full window: the work just ended counts as progress.
        since = timers.now();
        left = limit.ms;
        if (--working > 0 || holds > 0) return;
        arm(limit.ms);
      };
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
  /** A delegated continuation waits for a free slot like any other delegation. */
  queued?: boolean;
  /** A resumed delegated turn still reports to the original caller. */
  parent_run_id?: string | undefined;
  /** The turn a restart cut off, which this one picks back up. */
  resume_of?: string | undefined;
  /** A continuation of a delegated run a limit cut short is never continued again, even resumed. */
  continues?: string | undefined;
  /** A result turn that gave no answer, tried once more; never retried again. */
  retry_of?: string | undefined;
};

export type AdmitFn = (a: Admit) => RunRecord;

export function createEngine(deps: {
  vm?: import("../environments/computer.ts").Computer | undefined;
  store: Store;
  harnesses: Harnesses;
  tools: Tool[];
  log: Log;
  call: ToolCall;
  /** How agents act and how far their files reach (engine/permissions.ts). */
  permissions: Permissions;
  home: string;
  /** The other agent apps whose skills agents may load too. */
  skillApps?: RuntimeHomes | undefined;
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
  /** How long an outside engine may go without an event (tests shorten it). */
  engineIdleMs?: number;
  /** How long a turn on our own loop may go without progress (tests shorten it). */
  turnIdleMs?: number;
  /** The most a delegated run may work in all (tests shorten it). */
  a2aCapMs?: number;
  /** Timer source for run deadlines, independent of transports and background work. */
  runTimers?: RunTimers;
  /** Timer source for how long answers of teammates asked together wait for each other (tests drive it). */
  fanoutTimers?: RunTimers;
  /** Whether the Mac slept since a moment (engine/awake.ts): a turn it cut short gets one more window. */
  sleptSince?: (since: number) => boolean;
  /** MCP servers' tools for a thread (its project's approved ones and the owner's). */
  mcpTools?: (thread: Thread) => Promise<Tool[]>;
  /** The MCP servers a thread may reach, by name, without starting them. */
  mcpServers?: (thread: Thread) => string[];
  /** Whether a connected node lends this capability now (a phone's location). */
  hasCap?: (cap: string) => boolean;
  /** Whether a desktop app is linked as a node. */
  desktopLinked?: () => boolean;
  /** Work on the thread once a run ended (title, compaction); never blocks the next run. */
  afterRun?: (run: RunRecord) => void;
}) {
  const { store, log } = deps;
  const busy = new Set<string>();
  const running = new Set<Promise<void>>();
  /** Running turns: run id → its abort controller, thread and deadline, and what cuts its current step short. */
  const active = new Map<string, { ac: AbortController; thread: string; clock: Clock; cut: AbortController }>();
  const live = new Map<string, Display>();
  /**
   * What reaches a running turn between its steps, not yet taken by its loop: the owner's words, or (`apx`) a result
   * that would otherwise start a turn of its own, such as a background command's end (DECISIONS.md#d-162).
   */
  const steered = new Map<
    string,
    Array<{
      text: string;
      apx?: Admit;
      message_id?: string;
      task_assignment?: Extract<Origin, { kind: "user" }>["task_assignment"];
    }>
  >();
  /** The running turn of `agentId` in `threadId` whose loop takes text mid-turn (ours), if any. */
  const steerable = (threadId: string, agentId?: string): RunRecord | undefined => {
    for (const [runId, a] of active) {
      if (a.thread !== threadId || a.ac.signal.aborted) continue;
      const run = store.runs.get(runId);
      if (run?.harness !== "native" || (agentId && run.agent_id !== agentId)) return undefined;
      return run;
    }
    return undefined;
  };
  /** Hands a result to the agent's running turn instead of a turn of its own; false when none can take it. */
  const steerResult = (a: Admit): boolean => {
    const run = steerable(a.thread_id, a.agent_id);
    if (!run) return false;
    steered.set(run.id, [...(steered.get(run.id) ?? []), { text: frameInput(a.origin, a.text), apx: a }]);
    return true;
  };
  const waiters = new Map<string, Set<(run: RunRecord) => void>>();
  let stopping = false;

  const delegations = createDelegations({
    store,
    kick,
    live,
    ended,
    windowMs: (threadId) => runLimit(store, threadId, "a2a", deps).ms,
    deliver: (parent, child, stopped) => fanout.arrive(parent, child, stopped),
  });

  const fanout = createFanout({
    store,
    timers: deps.fanoutTimers ?? wallRunTimers,
    holdMs: FANOUT_HOLD_MS,
    running: (runId) => active.has(runId),
    deliver: (parent, results) => deliverResults(store, admit, parent, results),
    mark: (parent, child, held) => delegations.mark(parent, child, held),
  });

  const jobs = createJobs({ store, home: deps.home, log, admit: (a) => admit(a), steer: (a) => steerResult(a) });

  // The turn's clock stops while it waits for the owner: their time to answer is not the agent's time to work.
  const inputs = createInputs({
    store,
    home: deps.home,
    admit: (a) => admit(a),
    hold: (runId) => {
      const clock = active.get(runId)?.clock;
      clock?.pause();
      // A delegation waiting for the owner gives its slot to a queued one (DECISIONS.md#d-096).
      const run = store.runs.get(runId);
      const from = run ? store.threads.get(run.thread_id)?.parent_id : undefined;
      if (from) delegations.release(from);
      return () => clock?.resume();
    },
    ...(deps.inputWaits ? { waits: deps.inputWaits } : {}),
  });

  function admit(a: Admit): RunRecord {
    // Null records missing authority at arrival; replay must not acquire a later assignment.
    const origin =
      a.trigger === "user" &&
      a.origin.kind === "user" &&
      a.origin.task_assignment === undefined &&
      !a.resume_of &&
      !a.retry_of
        ? { ...a.origin, task_assignment: ownerTaskAssignment(store, a.thread_id, a.agent_id) ?? null }
        : a.origin;
    // The owner's words from the app wait in line when a turn is ahead of them (DECISIONS.md#d-186).
    const asked = a.trigger === "user" && a.origin.kind === "user" && !a.resume_of ? a.origin.message_id : undefined;
    const behind = Boolean(asked) && (busy.has(a.thread_id) || Boolean(store.runs.nextQueued(a.thread_id)));
    const run = store.runs.create({
      thread_id: a.thread_id,
      agent_id: a.agent_id,
      ...(a.queued ? { state: "queued" as const } : {}),
      trigger: a.trigger,
      input: {
        origin,
        text: a.text,
        ...(a.attachments?.length ? { attachments: a.attachments } : {}),
        reply_to: a.reply_to !== undefined ? a.reply_to : (store.threads.context(a.thread_id).reply_to ?? null),
        ...(a.resume_of ? { resume_of: a.resume_of } : {}),
        ...(a.continues ? { continues: a.continues } : {}),
        ...(a.retry_of ? { retry_of: a.retry_of } : {}),
      },
      depth: a.depth ?? 0,
      parent_run_id: a.parent_run_id,
      deadline_at: new Date(Date.now() + runLimit(store, a.thread_id, a.trigger, deps).ms).toISOString(),
    });
    if (store.threads.get(a.thread_id)?.state !== "working")
      store.threads.patch(a.thread_id, { state: a.queued ? "queued" : "submitted" });
    if (asked && behind) store.messages.setWaiting(asked, { until: "turn", run: run.id });
    // After the caller's transaction commits: the turn must never run on a row that could still roll back.
    queueMicrotask(() => {
      kick(a.thread_id);
      // The owner writing starts a new breaker window: delegations it held may start.
      if (a.trigger === "user") delegations.release(a.thread_id);
    });
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
    // Before any await: from here its message is no longer in line, and edits to it are refused.
    const asked = askedIn(run);
    if (asked && store.messages.get(asked)?.waiting) {
      store.messages.toEnd(asked);
      store.messages.setWaiting(asked, undefined);
    }
    const ac = new AbortController();
    // A restart re-runs queued work with a fresh deadline: the clock starts when the run can actually work.
    const limit = runLimit(deps.store, run.thread_id, run.trigger, deps);
    const timers = deps.runTimers ?? wallRunTimers;
    const begun = timers.now();
    let forgiven = false;
    const clock: Clock = pausableClock(
      limit,
      (capped) => {
        // Timers do not run while the Mac sleeps and fire at once when it wakes: a turn that made no progress across
        // a sleep is not stuck, it gets one more window (DECISIONS.md#d-153).
        if (!capped && !forgiven && deps.sleptSince?.(begun)) {
          forgiven = true;
          log.info({ run: run.id }, "turn deadline reached across a sleep: one more window");
          clock.touch();
          return;
        }
        ac.abort(
          new DeadlineExceeded(
            capped
              ? `it worked the ${timeSpan(limit.cap ?? 0)} a delegated run may work and was stopped`
              : limit.engine
                ? `the engine sent nothing for ${timeSpan(limit.ms)} and was stopped`
                : `the turn made no progress for ${timeSpan(limit.ms)} and was stopped`,
          ),
        );
      },
      (at) => deps.store.runs.setDeadline(run.id, new Date(at).toISOString()),
      deps.runTimers,
    );
    const entry = { ac, thread: run.thread_id, clock, cut: new AbortController() };
    active.set(run.id, entry);
    try {
      const takeSteered = () => {
        const taken = steered.get(run.id) ?? [];
        steered.set(run.id, []);
        for (const s of taken) if (s.message_id) store.messages.setWaiting(s.message_id, undefined);
        return taken.map((s) => (s.apx ? s.text : `${OWNER_ADDS}\n${s.text}`));
      };
      // What the owner's "send now" aborts: the step in progress, never the turn (DECISIONS.md#d-186).
      const stepSignal = () => {
        if (entry.cut.signal.aborted) entry.cut = new AbortController();
        return entry.cut.signal;
      };
      // Waiting on a delegate at work is the turn at work too.
      const delegate: typeof delegations.delegate = (...a) => delegations.delegate(...a).finally(clock.busy());
      const done = await runTurn(
        { ...deps, inputs, jobs, takeSteered, stepSignal, delegate, alive: clock.touch, busy: clock.busy },
        run,
        ac.signal,
      );
      ended(done);
      // A turn APX's shutdown cut off is not over: the next boot closes and resumes it.
      if (TERMINAL.has(done.state)) deps.afterRun?.(done);
      retryDropped(done);
    } finally {
      clock.stop();
      active.delete(run.id);
      // Steered text the turn ended before taking is not lost: it runs next, as a normal message or result.
      for (const s of steered.get(run.id) ?? [])
        admit(
          s.apx ?? {
            thread_id: run.thread_id,
            agent_id: run.agent_id,
            trigger: "user",
            origin: {
              kind: "user",
              task_assignment: s.task_assignment ?? null,
              ...(s.message_id ? { message_id: s.message_id } : {}),
            },
            text: s.text,
          },
        );
      steered.delete(run.id);
      live.delete(run.id);
      delegations.callerEnded(run.id);
    }
  }

  /**
   * "Send now" on a waiting message: the running turn cuts its step short and takes it at once. A message in line
   * leaves the line for that turn. When the agent only takes words between turns (an outside engine) or the message
   * has files, the turn at work is stopped as the owner's new message would (what it delegated keeps going) and the
   * message runs first in line, at once (`now` true); with no turn at work it only goes first (`now` false).
   */
  function sendNow(messageId: string): { now: boolean } {
    const message = store.messages.get(messageId);
    if (!message) throw notFound(`message ${messageId}`);
    if (!message.waiting) throw conflict("your agent already took this message");
    const running = [...active.entries()].find(([, a]) => a.thread === message.thread_id && !a.ac.signal.aborted);
    if (message.waiting.until === "step") {
      running?.[1].cut.abort();
      return { now: Boolean(running) };
    }
    const queued = store.runs.get(message.waiting.run ?? "");
    if (queued?.state !== "submitted" || askedIn(queued) !== messageId) throw conflict("its turn already started");
    const into = steerable(message.thread_id, queued.agent_id);
    const origin = queued.input?.origin;
    const task_assignment = origin?.kind === "user" ? (origin.task_assignment ?? null) : null;
    const target = into?.input?.origin;
    const targetAssignment = target?.kind === "user" || target?.kind === "agent" ? target.task_assignment : undefined;
    const sameAssignment =
      task_assignment?.task === targetAssignment?.task && task_assignment?.id === targetAssignment?.id;
    if (!into || !running || queued.input?.attachments?.length || !sameAssignment) {
      const rest = lineOf(store, message.thread_id).flatMap((l) => (l.run.id === queued.id ? [] : [l.run.id]));
      reorderLine(store, message.thread_id, [queued.id, ...rest]);
      return { now: Boolean(running) && stopRunning(message.thread_id, new Superseded()) > 0 };
    }
    store.tx(() => {
      ended(store.runs.setState(queued, "canceled", "sent into the turn that was running", { reason: "canceled" }));
      store.runs.setReplyTo(into.id, queued.input?.reply_to ?? null);
      store.messages.toEnd(messageId);
      steered.set(into.id, [
        ...(steered.get(into.id) ?? []),
        { text: queued.input?.text ?? "", message_id: messageId, task_assignment },
      ]);
      store.messages.setWaiting(messageId, { until: "step", ...(task_assignment ? { task_assignment } : {}) });
    });
    running[1].cut.abort();
    return { now: true };
  }

  /**
   * Enter on a message that went into line behind a turn of an outside engine, which cannot take words mid-turn: it
   * is "Send now" at once (DECISIONS.md#d-189). Our own loop's turn takes Enter's words itself; true when it acted.
   */
  function enterNow(messageId: string): boolean {
    const message = store.messages.get(messageId);
    if (message?.waiting?.until !== "turn") return false;
    const outside = [...active.entries()].some(([runId, a]) => {
      if (a.thread !== message.thread_id || a.ac.signal.aborted) return false;
      const harness = store.runs.get(runId)?.harness;
      return harness !== undefined && harness !== "native";
    });
    if (!outside) return false;
    sendNow(messageId);
    return true;
  }

  /**
   * Boot: words a restart cut off before the turn took them run as a turn of their own, and a message whose turn is
   * gone no longer waits.
   */
  function requeueWaiting(): void {
    for (const m of store.messages.waitingIn()) {
      const queued = m.waiting?.until === "turn" ? store.runs.get(m.waiting.run ?? "") : undefined;
      if (queued?.state === "submitted") continue;
      const agent = store.threads.get(m.thread_id)?.agent_ids[0];
      const text = m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
      if (m.waiting?.until !== "step" || !agent || !text) {
        store.messages.setWaiting(m.id, undefined);
        continue;
      }
      const run = admit({
        thread_id: m.thread_id,
        agent_id: agent,
        trigger: "user",
        origin: { kind: "user", message_id: m.id, task_assignment: m.waiting.task_assignment ?? null },
        text,
      });
      store.messages.setWaiting(m.id, { until: "turn", run: run.id });
    }
  }

  /** A result the agent dropped (no word, no tool) gets one more turn; a second silence is left for the owner's tray. */
  function retryDropped(run: RunRecord): void {
    if (!run.input || run.input.retry_of || run.input.resume_of || !droppedResult(store, run)) return;
    // Paused, or the owner already wrote again: the result waits for that turn instead.
    if (trip(store, run.thread_id) || agentTrip(store, run.thread_id, run.agent_id)) return;
    if (store.runs.nextQueued(run.thread_id)) return;
    log.warn({ run: run.id, thread: run.thread_id }, "a result turn gave no answer: trying it once more");
    admit({
      thread_id: run.thread_id,
      agent_id: run.agent_id,
      trigger: run.trigger,
      origin: run.input.origin,
      text: run.input.text,
      depth: run.depth,
      reply_to: run.input.reply_to,
      retry_of: run.id,
    });
  }

  function ended(run: RunRecord): void {
    for (const w of waiters.get(run.id) ?? []) w(run);
    waiters.delete(run.id);
    delegations.childEnded(run);
    fanout.settle(run);
    relayEnded(store, admit, run);
  }

  /**
   * Aborts the thread's running turn and cancels the sub-threads that turn opened, unless a new message from the owner
   * cut it: then what it delegated keeps working and reports back to the chat.
   */
  function stopRunning(threadId: string, why: Canceled = new Canceled()): number {
    let n = 0;
    for (const [runId, a] of active) {
      if (a.thread !== threadId || a.ac.signal.aborted) continue;
      a.ac.abort(why);
      n++;
      if (why instanceof Superseded) continue;
      for (const child of store.runs.children(runId)) n += cancel(child.thread_id);
    }
    return n;
  }

  /** Cancels the thread's queued and running turns and, recursively, its sub-threads'. */
  function cancel(threadId: string): number {
    fanout.drop(threadId);
    let n = 0;
    for (const id of store.runs.queuedIds(threadId)) {
      const r = store.runs.get(id);
      if (r) {
        ended(store.runs.setState(r, "canceled", "canceled before it started"));
        const asked = askedIn(r);
        if (asked && store.messages.get(asked)?.waiting) store.messages.setWaiting(asked, undefined);
        n++;
      }
    }
    n += stopRunning(threadId);
    for (const child of store.threads.children(threadId)) n += cancel(child);
    // A chat left waiting on the owner with no turn running (an open question, a restart) still stops.
    if (!busy.has(threadId)) n += inputs.close(threadId);
    if (n && !busy.has(threadId)) store.threads.patch(threadId, { state: "canceled" });
    return n;
  }

  return {
    admit,
    cancel,
    /** Starts the thread's queued delegations that fit (after the owner lets agents go on); how many it started. */
    release: (threadId: string) => delegations.release(threadId),
    /**
     * Hands owner text to the thread's running turn when its loop can take it mid-turn (ours); else undefined. With
     * `messageId`, the message shows it waits until the turn takes it.
     */
    steer(threadId: string, text: string, messageId?: string): RunRecord | undefined {
      const run = steerable(threadId);
      if (!run) return undefined;
      const task_assignment = messageId ? (ownerTaskAssignment(store, threadId, run.agent_id) ?? null) : null;
      steered.set(run.id, [
        ...(steered.get(run.id) ?? []),
        { text, task_assignment, ...(messageId ? { message_id: messageId } : {}) },
      ]);
      if (messageId)
        store.messages.setWaiting(messageId, { until: "step", ...(task_assignment ? { task_assignment } : {}) });
      return run;
    },
    /** Changes the words of a message in line, before its turn starts. */
    editQueued: (runId: string, text: string) => editInLine(store, runId, text),
    /** Takes a message out of the line and the chat, before its turn starts. */
    removeQueued: (runId: string) => removeFromLine(store, runId, ended),
    reorderQueued: (threadId: string, runs: readonly string[]) => reorderLine(store, threadId, runs),
    sendNow,
    enterNow,
    /** The owner's answer to something an agent asked (runs.respond). */
    respond: inputs.respond,
    pending: inputs.pending,
    jobs,
    /** Stops only the turn in progress for the owner's new message; queued inputs and what it delegated still run. */
    interrupt: (threadId: string) => stopRunning(threadId, new Superseded()),
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
      fanout.restore();
      inputs.restore();
      jobs.reconcile();
      const interrupted = recoverInterrupted(store);
      if (interrupted.length) log.warn({ runs: interrupted.length }, "closed runs interrupted by the last restart");
      const cut: RunRecord[] = [];
      for (const { run, resume } of interrupted) {
        // The resumed turn settles the caller's card and reports to it; the cut one wakes nobody.
        if (!resume || !run.input) {
          cut.push(run);
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
          continues: run.input.continues,
        });
      }
      // Only once the resumed ones hold their slots: a slot a cut delegation frees must not let a queued one in too.
      for (const run of cut) ended(run);
      requeueWaiting();
      for (const threadId of store.runs.queuedThreads()) kick(threadId);
      // After the resumed delegations are admitted, so they hold their slots first.
      for (const threadId of store.runs.heldParents()) delegations.release(threadId);
    },
    /** Shutdown: stops every running turn (left open, so the next boot resumes it) and waits for them to finish writing. */
    async stop(): Promise<void> {
      stopping = true;
      fanout.stop();
      for (const a of active.values()) a.ac.abort(new Shutdown());
      await Promise.allSettled([...running, jobs.stopAll()]);
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
