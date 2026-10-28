// Runs published Flow graphs as drawn (DECISIONS.md#d-167). One run per Flow at a time, oldest first, a few Flows at
// once. Each step goes through its checkpoint, so it runs once; a step whose effect is uncertain is left for the owner,
// never repeated. Nothing here polls: receipts, management changes, a run ending, startup and deadlines wake it.
import { createHash } from "node:crypto";
import type { FlowBinding, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import { type FlowGraphRun, type FlowStepKey, flowUncertainWhy } from "./domain/flow-graph-runs.ts";
import {
  conditionBranch,
  evaluateFlowCondition,
  evaluateFlowVars,
  FLOW_OTHERWISE,
  type FlowNodeSnapshot,
  flowCases,
  flowVarIndex,
  planFlowGraphStep,
  resolveFlowInput,
  summarizeFlowGraph,
} from "./domain/flow-graph-semantics.ts";
import { TERMINAL } from "./domain/runs.ts";
import type { Store } from "./domain/store.ts";
import type { RunTimers } from "./engine/engine.ts";
import { answerOf } from "./engine/run-outcome.ts";
import { createOutwardSteps, type FlowHttpDeps, type FlowNotifier } from "./flow-outward-steps.ts";
import { createWorkSteps } from "./flow-work-steps.ts";
import type { Log } from "./log.ts";
import type { Llm } from "./providers/llm.ts";
import { type ErrorKind, ProviderError } from "./providers/types.ts";
import type { Dispatch } from "./rpc/router.ts";

/** Flows advancing at the same time; each runs one event at a time. */
const ADVANCING = 4;
const wall: RunTimers = {
  now: () => Date.now(),
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};
/** Why a step did not succeed, as a code the panel says in the owner's words; never a provider's or payload's text. */
const WHY = {
  missing: "missing_value",
  table: "table_full",
  model: "model_unavailable",
  refused: "model_refused",
  cut: "model_cut",
  unknown: "model_uncertain",
  start: "not_started",
  runFailed: "run_failed",
  runCanceled: "run_canceled",
  silent: "run_silent",
  deadline: "deadline",
  value: "value_too_large",
} as const;
class StepStopped extends Error {}
/** Provider answers that turned the request down before doing it; anything else after sending is unknown. */
const REFUSALS = new Set<ErrorKind>(["auth", "bad_request", "model_gone", "context", "quota", "rate_limit"]);
const WORK = new Set<FlowNode["kind"]>(["table_write", "llm", "agent", "routine", "notify", "http", "sql", "cmd"]);

/** The first check that went by otherwise, when no step that does work ran: the run was cut short there. */
function cutBy(run: FlowGraphRun): string | undefined {
  const ran = run.graph.nodes.some((n) => WORK.has(n.kind) && run.steps.get(n.id)?.state === "succeeded");
  if (ran) return undefined;
  const otherwise = (id: string) => {
    const s = run.steps.get(id);
    try {
      return s?.state === "succeeded" && conditionBranch(s.output) === FLOW_OTHERWISE;
    } catch {
      return false;
    }
  };
  return run.graph.nodes
    .filter((n) => n.kind === "condition" && otherwise(n.id))
    .map((n) => n.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
}

export type FlowGraphExecutorDeps = {
  store: Store;
  dispatch(): Dispatch | undefined;
  llm: Llm;
  log: Log;
  /** Stops a thread's turns (the engine's cancel): runs a run that outlived its Flow run are asked to stop. */
  cancelThread(thread: string): void;
  timers?: RunTimers | undefined;
  notifier?: FlowNotifier | undefined;
  http?: FlowHttpDeps | undefined;
  /** APX's folder: where a project without a folder of its own runs its commands. */
  home?: string | undefined;
};

export function createFlowGraphExecutor(deps: FlowGraphExecutorDeps) {
  const { store, log } = deps;
  const runs = store.flowGraphRuns;
  const timers = deps.timers ?? wall;
  const now = () => new Date(timers.now());
  let closed = false;
  let recovered = false;
  const wanted = new Set<string>();
  const advancing = new Map<string, Promise<void>>();
  /** Model calls in flight, by the run they belong to. */
  const calls = new Map<AbortController, string>();
  const runKey = (flow: string, event: string) => `${flow}\u0000${event}`;
  let disarm: (() => void) | undefined;
  const outward = createOutwardSteps({
    store,
    timers,
    notifier: deps.notifier,
    http: deps.http,
    track(ac, run) {
      calls.set(ac, runKey(run.flow, run.event));
      return () => calls.delete(ac);
    },
  });

  const work = createWorkSteps({
    store,
    timers,
    home: deps.home,
    track(ac, run) {
      calls.set(ac, runKey(run.flow, run.event));
      return () => calls.delete(ac);
    },
  });

  const keyOf = (run: FlowGraphRun, node: string): FlowStepKey => ({
    flow: run.flow,
    event: run.event,
    revision: run.revision,
    node,
  });
  const snapshotsOf = (run: FlowGraphRun) =>
    new Map<string, FlowNodeSnapshot>(
      [...run.steps.values()].map((s) => [s.node, { state: s.state, output: s.output }]),
    );
  const idem = (kind: string, k: FlowStepKey) =>
    `flow-${kind}:${createHash("sha256")
      .update(JSON.stringify([k.flow, k.event, k.revision, k.node]))
      .digest("hex")
      .slice(0, 40)}`;

  /** Asks every run a Flow run left behind (ended, cancelled) to stop; repeated on each pass until they end. */
  function stopOrphans() {
    for (const id of runs.orphanRuns()) {
      const thread = store.runs.get(id)?.thread_id;
      if (thread) deps.cancelThread(thread);
    }
  }

  /** The deadline passed: nothing new starts, a sent model call stays uncertain, runs it waits for are stopped. */
  function expire(run: FlowGraphRun, at: Date) {
    for (const step of run.steps.values()) {
      const k = keyOf(run, step.node);
      if (step.state === "pending") runs.settle(k, ["pending"], "cancelled", at, WHY.deadline);
      else if (step.state === "running" && step.phase === "dispatched")
        runs.settle(
          k,
          ["running"],
          "uncertain",
          at,
          flowUncertainWhy(run.graph.nodes.find((n) => n.id === step.node)?.kind),
        );
      else if (step.state === "running" || step.state === "waiting_run")
        runs.settle(k, ["running", "waiting_run"], "cancelled", at, WHY.deadline);
    }
    const after = runs.load(run.flow, run.event);
    const state = after ? summarizeFlowGraph(snapshotsOf(after)) : "cancelled";
    runs.finish(run.flow, run.event, state === "uncertain" ? "uncertain" : "cancelled", at);
    stopOrphans();
  }

  /** A run a step handed work to ended: its own final answer is the step's output. */
  function collect(run: FlowGraphRun, node: string, runId: string, at: Date): boolean {
    const r = store.runs.get(runId);
    if (!r || !TERMINAL.has(r.state)) return false;
    const k = keyOf(run, node);
    const text =
      r.state === "completed" && r.end_reason !== "step_limit" && r.end_reason !== "deadline"
        ? answerOf(store, r)
        : undefined;
    if (text) {
      try {
        if (runs.succeed(k, "waiting_run", { text }, at, run.deadline)) return true;
      } catch {
        return runs.settle(k, ["waiting_run"], "failed", at, WHY.value);
      }
      return false;
    }
    const why = r.state === "failed" ? WHY.runFailed : r.state === "canceled" ? WHY.runCanceled : WHY.silent;
    return runs.settle(k, ["waiting_run"], "failed", at, why);
  }

  async function callModel(
    run: FlowGraphRun,
    node: Extract<FlowNode, { kind: "llm" }>,
    k: FlowStepKey,
    input: unknown,
  ) {
    const ac = new AbortController();
    calls.set(ac, runKey(run.flow, run.event));
    const stop = timers.after(Math.max(0, Math.min(node.timeoutMs, run.deadline - timers.now())), () =>
      ac.abort(new StepStopped("deadline")),
    );
    try {
      const out = await deps.llm.complete({
        models: [node.model],
        messages: [
          { role: "system", content: node.prompt },
          // Data, never instructions: whatever arrived with the event or came from earlier steps.
          { role: "user", content: `Untrusted input JSON:\n${JSON.stringify(input)}` },
        ],
        tools: [],
        signal: ac.signal,
        maxOutputTokens: node.maxOutputTokens,
        once: true,
        onDispatch: () => {
          if (!runs.dispatch(k, now(), run.deadline)) throw new StepStopped("ended");
        },
      });
      const text = out.message.content;
      if (out.finish !== "stop" || out.message.tool_calls?.length || typeof text !== "string" || !text.trim()) {
        runs.settle(k, ["running"], "failed", now(), WHY.cut);
        return;
      }
      try {
        runs.succeed(k, "running", { text }, now(), run.deadline);
      } catch {
        runs.settle(k, ["running"], "failed", now(), WHY.value);
      }
    } catch (err) {
      if (closed) return;
      const sent = runs.load(run.flow, run.event)?.steps.get(k.node)?.phase === "dispatched";
      const at = now();
      if (!sent) runs.settle(k, ["running"], err instanceof StepStopped ? "cancelled" : "failed", at, WHY.model);
      // A refusal is the provider's answer; a cut connection or a timeout leaves it unknown.
      else if (err instanceof ProviderError && REFUSALS.has(err.kind))
        runs.settle(k, ["running"], "failed", at, WHY.refused);
      else runs.settle(k, ["running"], "uncertain", at, WHY.unknown);
    } finally {
      stop();
      calls.delete(ac);
    }
  }

  /** Hands the step's input to its agent or routine through the router; the run is linked as it is admitted. */
  async function startRun(
    run: FlowGraphRun,
    node: Extract<FlowNode, { kind: "agent" | "routine" }>,
    k: FlowStepKey,
    input: unknown,
  ) {
    const dispatch = deps.dispatch();
    const flow = store.flows.get(run.flow);
    const agent = node.kind === "agent" ? store.agents.get(node.agent) : undefined;
    // The agent may have moved since admission: a Flow's step only hands work to one of its project or a global one.
    if (
      !dispatch ||
      !flow ||
      (node.kind === "agent" && (!agent || (agent.project_id && agent.project_id !== flow.projectId)))
    ) {
      runs.settle(k, ["running"], "failed", now(), WHY.start);
      return;
    }
    const ctx = {
      transport: "internal" as const,
      role: "operator" as const,
      actor: "agent" as const,
      session: undefined,
      log,
      flowEvent: { flow: run.flow, event: run.event, graph: { revision: run.revision, node: node.id } },
    };
    try {
      if (node.kind === "routine") {
        // The routine admission is the owner's own, as for legacy Flows; the step is checked against its revision.
        const started = await dispatch(
          "routines.run",
          { routine: node.routine },
          { ...ctx, actor: "human" },
          idem("routine", k),
        );
        if (!started.ok) throw new Error("Routine admission failed");
        return;
      }
      let thread = run.steps.get(node.id)?.thread_id ?? undefined;
      if (!thread) {
        const made = await dispatch(
          "threads.create",
          { kind: "loose", agent_id: node.agent, project_id: flow.projectId, title: `${flow.name} · ${node.label}` },
          ctx,
          idem("thread", k),
        );
        if (!made.ok) throw new Error("Flow thread creation failed");
        thread = (made.result as { id: string }).id;
      }
      const sent = await dispatch(
        "threads.send",
        { thread, text: `${node.prompt}\n\nUntrusted input JSON:\n${JSON.stringify(input)}`, mode: "queue" },
        ctx,
        idem("run", k),
      );
      if (!sent.ok) throw new Error("Agent admission failed");
    } catch {
      // Error bodies from providers or payloads never become Flow records.
      runs.settle(k, ["running"], "failed", now(), WHY.start);
    }
  }

  /** Runs one step that is ready. False when it must wait (its routine is busy). */
  async function execute(run: FlowGraphRun, node: FlowNode): Promise<boolean> {
    const k = keyOf(run, node.id);
    const at = now();
    const snapshots = snapshotsOf(run);
    // Steps that act outside APX build their own input from templates (flow-outward-steps.ts).
    if (node.kind === "notify") {
      await outward.notify(run, node, k, snapshots);
      return true;
    }
    if (node.kind === "http") {
      await outward.http(run, node, k, snapshots);
      return true;
    }
    // Code, SQL and commands run in processes of their own (flow-work-steps.ts).
    if (node.kind === "js" || node.kind === "sql" || node.kind === "cmd") {
      if (node.kind === "js") await work.js(run, node, k, snapshots);
      else if (node.kind === "sql") await work.sql(run, node, k, snapshots);
      else await work.cmd(run, node, k, snapshots);
      return true;
    }
    const reads = {
      resolve: (b: FlowBinding) => resolveFlowInput(b, run.payload, snapshots),
      vars: flowVarIndex(run.graph),
    };
    let input: unknown;
    try {
      input =
        node.kind === "webhook" || node.kind === "schedule"
          ? undefined
          : node.kind === "table_read"
            ? { keys: node.keys }
            : node.kind === "table_write"
              ? { key: node.key, value: resolveFlowInput(node.value, run.payload, snapshots) }
              : node.kind === "vars"
                ? undefined
                : node.kind === "condition"
                  ? flowCases(node).some((c) => c.match.kind === "equals")
                    ? resolveFlowInput(node.input, run.payload, snapshots)
                    : null
                  : resolveFlowInput(node.input, run.payload, snapshots);
    } catch {
      runs.settle(k, ["pending"], "failed", at, WHY.missing);
      return true;
    }
    // A value too large or not data fails its step, never the whole queue behind it.
    const pure = (effect: () => unknown, why: string = WHY.value) => {
      try {
        runs.runPure(k, input, at, effect);
      } catch {
        runs.settle(k, ["pending"], "failed", at, why);
      }
      return true;
    };
    const claim = (phase: "reserved" | null) => {
      try {
        return runs.claim(k, input, at, phase);
      } catch {
        runs.settle(k, ["pending"], "failed", at, WHY.value);
        return false;
      }
    };
    switch (node.kind) {
      case "webhook":
      case "schedule":
        return pure(() => run.payload);
      case "condition":
        return pure(() => evaluateFlowCondition(node, input, reads), WHY.missing);
      case "vars":
        return pure(() => evaluateFlowVars(node, reads), WHY.missing);
      case "table_read":
        return pure(() => ({ rows: store.flows.readRows(run.flow, node.keys) }));
      case "table_write":
        return pure(() => {
          const value = (input as { value: unknown }).value;
          store.flows.write(run.flow, node.key, value);
          return { value };
        }, WHY.table);
      case "llm":
        if (claim("reserved")) await callModel(run, node, k, input);
        return true;
      case "agent":
      case "routine": {
        if (node.kind === "routine") {
          const last = store.routines.get(node.routine)?.last;
          if (last && !TERMINAL.has(last.state)) return false;
        }
        // Before the router is up nothing can start: the step waits, unclaimed.
        if (!deps.dispatch()) return false;
        if (claim(null)) await startRun(run, node, k, input);
        return true;
      }
    }
  }

  /** Advances one run as far as it can go now. True when it ended. */
  async function advanceRun(flow: string, event: string): Promise<boolean> {
    while (!closed) {
      const run = runs.load(flow, event);
      if (run?.state !== "pending") return true;
      const at = now();
      if (at.getTime() >= run.deadline) {
        expire(run, at);
        return true;
      }
      let moved = false;
      for (const step of run.steps.values())
        if (step.state === "waiting_run" && step.run_id) moved = collect(run, step.node, step.run_id, at) || moved;
      if (moved) continue;
      const decisions = planFlowGraphStep(run.graph, snapshotsOf(run));
      for (const d of decisions)
        if (d.decision === "skipped" || d.decision === "blocked")
          moved = runs.settle(keyOf(run, d.node), ["pending"], d.decision, at) || moved;
      if (moved) continue;
      const ready = decisions.find((d) => d.decision === "ready");
      const node = ready && run.graph.nodes.find((n) => n.id === ready.node);
      if (node && store.flows.get(flow)?.enabled && (await execute(run, node))) continue;
      const state = summarizeFlowGraph(snapshotsOf(run));
      if (state === "pending" || state === "running") return false;
      runs.finish(flow, event, state, at, state === "succeeded" ? cutBy(run) : undefined);
      return true;
    }
    return false;
  }

  async function advance(flow: string) {
    do {
      wanted.delete(flow);
      for (;;) {
        const next = runs.active().find((e) => e.flow === flow);
        if (!next || closed || !(await advanceRun(next.flow, next.event))) break;
      }
    } while (wanted.has(flow) && !closed);
  }

  function pump() {
    for (const flow of wanted) {
      if (closed || advancing.size >= ADVANCING) return;
      if (advancing.has(flow)) continue;
      const going = advance(flow)
        .catch((err: unknown) =>
          log.warn({ flow, err: err instanceof Error ? err.name : "error" }, "a Flow run could not advance"),
        )
        .finally(() => {
          advancing.delete(flow);
          pump();
          arm();
        });
      advancing.set(flow, going);
    }
  }

  /** Ends every run past its deadline now, whether or not its Flow has a free slot or is busy with another. */
  function expireDue() {
    const at = now();
    for (const e of runs.active()) {
      if (e.deadline > at.getTime()) continue;
      const run = runs.load(e.flow, e.event);
      if (run) expire(run, at);
    }
  }

  /** Wakes at the earliest deadline still ahead; one already passed was ended by `expireDue`. */
  function arm() {
    disarm?.();
    disarm = undefined;
    if (closed) return;
    const at = timers.now();
    const next = Math.min(...runs.active().map((e) => (e.deadline > at ? e.deadline : Number.POSITIVE_INFINITY)));
    if (Number.isFinite(next)) disarm = timers.after(next - at, api.kick);
  }

  const api = {
    kick() {
      if (closed) return;
      if (!recovered) {
        recovered = true;
        const uncertain = runs.recover(now());
        if (uncertain) log.warn({ steps: uncertain }, "Flow steps stopped after sending are marked uncertain");
      }
      expireDue();
      stopOrphans();
      for (const { flow } of runs.active()) wanted.add(flow);
      pump();
      arm();
    },
    /**
     * The owner stops a run: its checkpoint ends it (DECISIONS.md#d-168), then its model call in flight is aborted and
     * the runs its steps started are asked to stop. Undefined when it was not going.
     */
    cancel(flow: string, event: string) {
      const state = runs.cancel(flow, event, now());
      if (!state) return undefined;
      for (const [ac, key] of calls) if (key === runKey(flow, event)) ac.abort(new StepStopped("cancelled"));
      stopOrphans();
      api.kick();
      return state;
    },
    async close() {
      closed = true;
      disarm?.();
      for (const ac of calls.keys()) ac.abort(new StepStopped("closing"));
      await Promise.allSettled(advancing.values());
    },
  };
  return api;
}
export type FlowGraphExecutor = ReturnType<typeof createFlowGraphExecutor>;
