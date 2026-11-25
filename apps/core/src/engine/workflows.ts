// Runs workflows: a plan of delegations that code, not the model, moves forward. Each agent call is a delegation
// (`open`), so the callee's mode, the caller's write ceiling, rules, budgets and depth apply as they do to `delegate`;
// this module only decides which call starts when, keeps their outputs and shows one card. See DECISIONS.md#d-272
import type { Part, WorkflowView } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { worksForOwner } from "../domain/owner-work.ts";
import { type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import {
  DEFAULT_PARALLEL,
  ENDED,
  itemLabel,
  outputOf,
  readiness,
  refOf,
  resultOf,
  type StepRef,
  type StepView,
  stageOf,
  stepsOf,
  taskText,
  type WorkflowPlan,
} from "../domain/workflow-plan.ts";
import type { WorkflowRecord, WorkflowStep } from "../domain/workflows.ts";
import { placeOf } from "../tools/agents.ts";
import { fromTeam } from "../tools/result.ts";
import { keepWhilePaused, tripped } from "./breaker.ts";
import type { Caller, DelegateTo, Opened, WorkflowMark } from "./delegation.ts";
import type { Display } from "./display.ts";
import type { AdmitFn, RunTimers } from "./engine.ts";
import { laterReplyTo } from "./home-channel.ts";
import { answerOf } from "./run-outcome.ts";

/** The most a workflow may run in all, from its start or its last resume. */
const WORKFLOW_CAP_MS = 4 * 3600_000;
/** What a later turn of the asking agent reads of the result, and what the card shows of it. */
const RESULT_CHARS = 20_000;
const CARD_RESULT_CHARS = 4000;
/** How many times a step whose JSON did not fit is asked again, in its own session. */
const OUTPUT_RETRIES = 1;

export type WorkflowDeps = {
  store: Store;
  open(from: Caller, req: DelegateTo, task: string, wf: WorkflowMark): Opened | { sent: string } | string;
  kick(threadId: string): void;
  /** Cancels a thread's turns and, recursively, its sub-threads'. */
  cancel(threadId: string): number;
  admit: AdmitFn;
  /** Answers still being written, by run: a card in one is updated through its display. */
  live: Map<string, Display>;
  timers: RunTimers;
};

const isCard = (id: string) => (p: Part) => p.type === "workflow" && p.workflow_id === id;

export function createWorkflows(deps: WorkflowDeps) {
  const { store } = deps;
  const deadlines = new Map<string, () => void>();
  /** Turns waiting inside a tool call for a workflow to end, by workflow. */
  const waiting = new Map<string, Set<(text: string | undefined) => void>>();

  const viewsOf = (steps: WorkflowStep[]): Map<string, StepView> =>
    new Map(steps.map((s) => [s.key, { key: s.key, state: s.state, output: s.output }]));

  /** Who a stage's agent is: the agent it names (in the asking chat's project), or the caller for a worker. */
  function calleeOf(w: WorkflowRecord, ref: StepRef): { agent?: AgentRecord; error?: string } {
    const stage = stageOf(w.plan, ref);
    if (!stage?.agent) return {};
    const found = store.agents.resolve(stage.agent, store.threads.get(w.thread_id)?.project_id);
    return "error" in found ? { error: found.error } : { agent: found.agent };
  }

  function labelOf(w: WorkflowRecord, ref: StepRef): string {
    if (!ref.finish && w.plan.items?.length) return itemLabel(w.plan.items[ref.item]) || `#${ref.item + 1}`;
    const stage = stageOf(w.plan, ref);
    return stage?.worker?.name ?? calleeOf(w, ref).agent?.name ?? stage?.agent ?? stage?.phase ?? ref.key;
  }

  function viewOf(w: WorkflowRecord, steps: WorkflowStep[]): WorkflowView {
    const byKey = new Map(steps.map((s) => [s.key, s]));
    const phases: WorkflowView["phases"] = [];
    for (const ref of stepsOf(w.plan)) {
      const stage = stageOf(w.plan, ref);
      const step = byKey.get(ref.key);
      if (!stage || !step) continue;
      const title = stage.phase.slice(0, 60);
      let phase = phases.find((p) => p.title === title);
      if (!phase) {
        phase = { title, steps: [] };
        phases.push(phase);
      }
      const agent = calleeOf(w, ref).agent;
      const ms =
        step.started_at && step.ended_at
          ? Math.max(0, new Date(step.ended_at).getTime() - new Date(step.started_at).getTime())
          : undefined;
      phase.steps.push({
        key: ref.key,
        label: labelOf(w, ref).slice(0, 200),
        state: step.state,
        ...(step.thread_id ? { thread_id: step.thread_id } : {}),
        agent_id: agent?.id ?? w.agent_id,
        ...(stage.worker ? { worker: stage.worker.name.slice(0, 40) } : {}),
        ...(ms !== undefined ? { ms } : {}),
        ...(step.error ? { error: step.error.slice(0, 300) } : {}),
      });
    }
    return {
      name: w.name.slice(0, 80),
      state: w.state,
      // Done means finished or not needed: a canceled or failed step is not done.
      done: steps.filter((s) => s.state === "done" || s.state === "skipped").length,
      total: steps.length,
      phases,
      ...(w.result !== undefined ? { result: w.result.slice(0, CARD_RESULT_CHARS) } : {}),
      ...(w.reason ? { reason: w.reason.slice(0, 300) } : {}),
    };
  }

  /** The card in the asking answer: through its display while that turn writes, else in its stored message. */
  function show(id: string): void {
    const w = store.workflows.get(id);
    if (!w) return;
    const part: Part = { type: "workflow", workflow_id: w.id, ...viewOf(w, store.workflows.steps(id)) };
    const display = deps.live.get(w.run_id);
    if (display) {
      display.upsert(isCard(id), part);
      return;
    }
    const msg = store.messages.ofRun(w.thread_id, w.run_id).find((m) => m.parts.some(isCard(id)));
    const index = msg?.parts.findIndex(isCard(id)) ?? -1;
    if (!msg || index < 0) return;
    const parts = [...msg.parts];
    parts[index] = part;
    store.messages.setPart({ ...msg, parts }, index);
  }

  /** The asking agent as it was: its turn, for the delegations' depth, lineage and the card. */
  function callerOf(w: WorkflowRecord): Caller | undefined {
    const run = store.runs.get(w.run_id);
    const agent = store.agents.get(w.agent_id);
    return run && agent ? { run, agent, display: deps.live.get(w.run_id) } : undefined;
  }

  function startStep(w: WorkflowRecord, ref: StepRef, steps: ReadonlyMap<string, StepView>, session?: string): void {
    const stage = stageOf(w.plan, ref);
    const caller = callerOf(w);
    const fail = (error: string) =>
      store.workflows.setStep(w.id, ref.key, {
        state: "failed",
        error: error.replace(/^refused: /, ""),
        ended_at: new Date().toISOString(),
      });
    if (!stage || !caller) {
      fail("the agent that started this workflow is gone");
      return;
    }
    const callee = calleeOf(w, ref);
    if (callee.error) {
      fail(callee.error);
      return;
    }
    const thread = store.threads.get(w.thread_id);
    const place = placeOf(store, stage.project, caller.agent, Boolean(thread && worksForOwner(store, thread)));
    if (typeof place === "string") {
      fail(place);
      return;
    }
    const text = session
      ? `Your answer's JSON did not fit what the workflow needs: ${store.workflows.step(w.id, ref.key)?.error ?? ""}. Answer again with only the \`\`\`json block.`
      : taskText(w.plan, ref, steps);
    const opened = deps.open(
      caller,
      {
        agent: callee.agent,
        worker: stage.worker,
        session,
        project: place.project,
        folder: place.folder,
        write: stage.write,
      },
      text,
      { id: w.id, key: ref.key },
    );
    if (typeof opened === "string") {
      fail(opened);
      return;
    }
    if ("sent" in opened) {
      fail("its session was still at work");
      return;
    }
    store.workflows.setStep(w.id, ref.key, {
      state: "working",
      thread_id: opened.sub.id,
      error: undefined,
      ...(session ? {} : { started_at: new Date().toISOString(), ended_at: undefined }),
    });
    deps.kick(opened.sub.id);
  }

  /** Starts what may start, skips what never will, and ends the workflow once every step has. */
  function pump(id: string): void {
    const w = store.workflows.get(id);
    if (w?.state !== "running") return;
    const why = tripped(store, w.thread_id);
    if (why) {
      stop(id, `agents are paused (${why}); resume it once they may go on`, false);
      return;
    }
    const refs = stepsOf(w.plan);
    const parallel = w.plan.parallel ?? DEFAULT_PARALLEL;
    // Each pass may skip steps whose earlier stage ended badly, which may end the items after them: go on until none.
    for (let pass = 0, changed = true; changed && pass <= refs.length * 2; pass++) {
      changed = false;
      const steps = viewsOf(store.workflows.steps(id));
      let working = [...steps.values()].filter((s) => s.state === "working").length;
      // Items further along go first, so results flow through the stages instead of waiting behind new items.
      const pending = refs
        .filter((r) => steps.get(r.key)?.state === "pending")
        .sort((a, b) => b.stage - a.stage || a.item - b.item);
      for (const ref of pending) {
        const r = readiness(w.plan, ref, steps);
        if (!r.ready && r.skip) {
          store.workflows.setStep(id, ref.key, { state: "skipped", error: r.skip });
          changed = true;
        } else if (r.ready && working < parallel) {
          startStep(w, ref, steps);
          // A step that could not start frees its slot and may end its item.
          if (store.workflows.step(id, ref.key)?.state === "working") working++;
          else changed = true;
        }
      }
    }
    const steps = store.workflows.steps(id);
    if (steps.every((s) => ENDED.has(s.state))) finish(id);
    else show(id);
  }

  function finish(id: string): void {
    const w = store.workflows.get(id);
    if (w?.state !== "running") return;
    const steps = store.workflows.steps(id);
    const failed = steps.filter((s) => s.state === "failed" || s.state === "canceled");
    const views = viewsOf(steps);
    const lines = failed.map((s) => {
      const ref = refOf(w.plan, s.key);
      return `- ${ref ? labelOf(w, ref) : s.key} (${ref ? stageOf(w.plan, ref)?.phase : ""}): ${s.error ?? s.state}`;
    });
    const result = `${resultOf(w.plan, views)}${lines.length ? `\n\nDid not finish:\n${lines.join("\n")}` : ""}`;
    disarm(id);
    store.workflows.set(id, {
      state: failed.length ? "failed" : "done",
      result,
      reason: failed.length ? `${failed.length} of ${steps.length} steps did not finish` : undefined,
    });
    show(id);
    deliver(id);
  }

  /** What the asking agent reads: the result, as its team's words, and how it ended. */
  function resultText(w: WorkflowRecord): string {
    const head =
      w.state === "done"
        ? "Every step finished."
        : w.state === "failed"
          ? `Some steps did not finish (${w.reason ?? "see below"}); resume it with workflow resume="${w.id}" to run them again, keeping what is done.`
          : `It stopped: ${w.reason ?? "stopped"}. Resume it with workflow resume="${w.id}" to go on, keeping what is done.`;
    return `${fromTeam("workflow_result", { name: w.name, state: w.state, id: w.id }, (w.result ?? "").slice(0, RESULT_CHARS))}\n${head}`;
  }

  /** The result to the turn waiting for it, else to a new turn of the asking agent. */
  function deliver(id: string): void {
    const w = store.workflows.get(id);
    if (!w) return;
    const waiters = waiting.get(id);
    if (waiters?.size) {
      for (const done of waiters) done(resultText(w));
      waiting.delete(id);
      return;
    }
    const asking = store.runs.get(w.run_id);
    if (!asking || !store.threads.get(w.thread_id)) return;
    const kept = keepWhilePaused(store, {
      thread_id: w.thread_id,
      agent_id: w.agent_id,
      who: `Workflow ${w.name}`,
      run_id: w.run_id,
      note: `The workflow ${w.name} ended (${w.state}) while agents were paused:\n${resultText(w)}`,
    });
    if (kept) return;
    deps.admit({
      thread_id: w.thread_id,
      agent_id: w.agent_id,
      trigger: "a2a_result",
      origin: { kind: "workflow_result", workflow_id: w.id, name: w.name, state: w.state },
      text: (w.result ?? "").slice(0, RESULT_CHARS),
      depth: asking.depth,
      reply_to: laterReplyTo(store, w.thread_id, asking.input?.reply_to),
    });
  }

  function arm(w: WorkflowRecord): void {
    disarm(w.id);
    const ms = Math.max(0, new Date(w.deadline_at).getTime() - deps.timers.now());
    deadlines.set(
      w.id,
      deps.timers.after(ms, () => {
        deadlines.delete(w.id);
        stop(w.id, `it ran for the ${WORKFLOW_CAP_MS / 3600_000} hours a workflow may`, true);
      }),
    );
  }

  function disarm(id: string): void {
    deadlines.get(id)?.();
    deadlines.delete(id);
  }

  /**
   * Stops a running workflow: its agents at work are canceled (each step shows it), and nothing starts after them.
   * `wake`: the asking agent gets what is done (APX stopped it); the owner's stop wakes nobody.
   */
  function stop(id: string, reason: string, wake: boolean): boolean {
    const w = store.workflows.get(id);
    if (w?.state !== "running") return false;
    disarm(id);
    const steps = store.workflows.steps(id);
    const views = viewsOf(steps);
    store.workflows.set(id, { state: "stopped", reason, result: resultOf(w.plan, views) });
    for (const s of steps) if (s.state === "working" && s.thread_id) deps.cancel(s.thread_id);
    show(id);
    const waiters = waiting.get(id);
    if (waiters?.size || wake) deliver(id);
    return true;
  }

  /** A run in a step's session ended: its output is kept (or asked again once), and the next steps may start. */
  function stepEnded(run: RunRecord): void {
    const mark = store.threads.context(run.thread_id).workflow;
    const w = mark ? store.workflows.get(mark.id) : undefined;
    const ref = w && mark ? refOf(w.plan, mark.key) : undefined;
    const step = w && ref ? store.workflows.step(w.id, ref.key) : undefined;
    if (!w || !ref || step?.state !== "working" || step.thread_id !== run.thread_id) return;
    const ended = new Date().toISOString();
    if (run.state !== "completed") {
      const why = run.state === "canceled" ? "it was stopped" : (run.error ?? `it ${run.state}`);
      store.workflows.setStep(w.id, ref.key, {
        state: run.state === "canceled" ? "canceled" : "failed",
        error: why,
        ended_at: ended,
      });
    } else {
      const answer = answerOf(store, run);
      const out = answer ? outputOf(stageOf(w.plan, ref), answer) : { error: "it gave no answer" };
      if ("output" in out)
        store.workflows.setStep(w.id, ref.key, {
          state: "done",
          output: out.output,
          error: undefined,
          tries: step.tries + 1,
          ended_at: ended,
        });
      else if (answer && step.tries < OUTPUT_RETRIES && w.state === "running") {
        store.workflows.setStep(w.id, ref.key, { error: out.error, tries: step.tries + 1 });
        const session = store.threads.get(run.thread_id)?.session;
        startStep(w, ref, viewsOf(store.workflows.steps(w.id)), session);
      } else
        store.workflows.setStep(w.id, ref.key, {
          state: "failed",
          error: out.error,
          tries: step.tries + 1,
          ended_at: ended,
        });
    }
    if (w.state === "running") pump(w.id);
    else show(w.id);
  }

  /** Waits inside the asking tool call for the workflow to end, up to `waitMs` or until the call is let go. */
  function waitFor(id: string, waitMs: number, signal?: AbortSignal): Promise<string | undefined> {
    const w = store.workflows.get(id);
    if (w && w.state !== "running") return Promise.resolve(resultText(w));
    return new Promise((resolve) => {
      const set = waiting.get(id) ?? new Set();
      waiting.set(id, set);
      let settled = false;
      const done = (text: string | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", letGo);
        set.delete(done);
        if (!set.size) waiting.delete(id);
        resolve(text);
      };
      const letGo = () => done(undefined);
      const timer = setTimeout(letGo, waitMs);
      if (signal?.aborted) letGo();
      else signal?.addEventListener("abort", letGo, { once: true });
      set.add(done);
    });
  }

  const keepsRunning = (w: WorkflowRecord) =>
    `The workflow "${w.name}" (id ${w.id}) keeps running; its card shows each agent's state. Its result comes back in a new turn: do not wait or ask for its status; tell the owner and go on.`;

  return {
    /**
     * Starts a workflow from the asking turn: its card goes in that turn's answer, its first steps start, and the
     * call waits up to `waitMs` for its result.
     */
    async start(caller: Caller, plan: WorkflowPlan, waitMs: number, signal?: AbortSignal): Promise<string> {
      const w = store.workflows.create({
        thread_id: caller.run.thread_id,
        agent_id: caller.agent.id,
        run_id: caller.run.id,
        plan,
        deadline_at: new Date(deps.timers.now() + WORKFLOW_CAP_MS).toISOString(),
        keys: stepsOf(plan).map((r) => r.key),
      });
      if (caller.display) {
        deps.live.set(caller.run.id, caller.display);
        caller.display.upsert(isCard(w.id), {
          type: "workflow",
          workflow_id: w.id,
          ...viewOf(w, store.workflows.steps(w.id)),
        });
      }
      arm(w);
      pump(w.id);
      const text = await waitFor(w.id, waitMs, signal);
      return text ?? keepsRunning(store.workflows.get(w.id) ?? w);
    },

    /**
     * Runs a stopped or failed workflow again: done steps keep their output, the others start over in new sessions.
     * From an agent's turn (`caller`), its card and result move to that turn.
     */
    async resume(id: string, caller?: Caller, waitMs = 0, signal?: AbortSignal): Promise<string> {
      const w = store.workflows.get(id);
      if (!w) return `no workflow ${id}`;
      if (w.state === "running") return keepsRunning(w);
      if (w.state === "done") return `the workflow "${w.name}" already finished: start a new one for more work`;
      if (caller && (caller.run.thread_id !== w.thread_id || caller.agent.id !== w.agent_id))
        return `the workflow "${w.name}" belongs to another chat or agent`;
      store.tx(() => {
        for (const s of store.workflows.steps(id))
          if (s.state !== "done")
            store.workflows.setStep(id, s.key, {
              state: "pending",
              thread_id: undefined,
              error: undefined,
              tries: 0,
              started_at: undefined,
              ended_at: undefined,
            });
        store.workflows.set(id, {
          state: "running",
          reason: undefined,
          result: undefined,
          deadline_at: new Date(deps.timers.now() + WORKFLOW_CAP_MS).toISOString(),
          ...(caller ? { run_id: caller.run.id } : {}),
        });
      });
      const now = store.workflows.get(id) ?? w;
      if (caller?.display) {
        deps.live.set(caller.run.id, caller.display);
        caller.display.upsert(isCard(id), {
          type: "workflow",
          workflow_id: id,
          ...viewOf(now, store.workflows.steps(id)),
        });
      }
      arm(now);
      pump(id);
      if (!waitMs) return keepsRunning(now);
      const text = await waitFor(id, waitMs, signal);
      return text ?? keepsRunning(store.workflows.get(id) ?? now);
    },

    stop: (id: string) => stop(id, "the owner stopped it", false),

    /** The owner stopped a chat: the workflows it started stop too. */
    stopIn(threadId: string): void {
      for (const w of store.workflows.ofThread(threadId))
        if (w.state === "running") stop(w.id, "the chat was stopped", false);
    },

    stepEnded,

    /** A workflow's state for an app or an agent: its card and each step's output. */
    get(id: string) {
      const w = store.workflows.get(id);
      if (!w) return undefined;
      const steps = store.workflows.steps(id);
      return {
        workflow: { id: w.id, thread_id: w.thread_id, ...viewOf(w, steps) },
        outputs: steps.flatMap((s) => (s.output !== undefined ? [{ key: s.key, output: s.output }] : [])),
      };
    },

    /**
     * Boot, once interrupted runs were resumed or closed: each running workflow waits out the rest of its time, a step
     * whose session has nothing left running takes its last run's end, and what may start starts.
     */
    restore(): void {
      for (const w of store.workflows.running()) {
        if (new Date(w.deadline_at).getTime() <= deps.timers.now()) {
          stop(w.id, `it ran for the ${WORKFLOW_CAP_MS / 3600_000} hours a workflow may`, true);
          continue;
        }
        arm(w);
        for (const s of store.workflows.steps(w.id)) {
          if (s.state !== "working" || !s.thread_id) continue;
          const runs = store.runs.list(s.thread_id, 5);
          if (runs.some((r) => !TERMINAL.has(r.state))) continue;
          const last = runs[0];
          if (last) stepEnded(last);
          else store.workflows.setStep(w.id, s.key, { state: "pending", thread_id: undefined });
        }
        pump(w.id);
      }
    },

    /** Shutdown: timers go; running workflows stay running for the next boot. */
    close(): void {
      for (const id of [...deadlines.keys()]) disarm(id);
      for (const set of waiting.values()) for (const done of set) done(undefined);
      waiting.clear();
    },
  };
}

