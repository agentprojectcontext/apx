import { randomUUID } from "node:crypto";
import type { CoreEvent } from "@apx/protocol";
import { type FlowDraftGraph, FlowGraph, type FlowGraphIssue } from "../../../packages/protocol/src/flow-graph.ts";
import type { FlowDefinition } from "../../../packages/protocol/src/flow-methods.ts";
import { FlowCapacityError } from "./domain/flow-events.ts";
import { flowGapIssues, validateFlowGraph } from "./domain/flow-graph-validate.ts";
import { FlowTriggerMismatch } from "./domain/flow-graphs.ts";
import { dueFlowTick } from "./domain/flow-schedules.ts";
import { ownerTimeZone } from "./domain/owner.ts";
import { TERMINAL } from "./domain/runs.ts";
import type { Store } from "./domain/store.ts";
import type { RunTimers } from "./engine/engine.ts";
import { badRequest, conflict, errorMessage, notFound } from "./errors.ts";
import { flowEngineOf } from "./flow-ai-step.ts";
import { createFlowGraphExecutor } from "./flow-graph-executor.ts";
import { type FlowOutside, flowOutwardIssues } from "./flow-outward.ts";
import type { FlowHttpDeps, FlowNotifier } from "./flow-outward-steps.ts";
import { createFlowTests, flowEventOf, shownHeaders } from "./flow-tests.ts";
import type { Log } from "./log.ts";
import type { Llm } from "./providers/llm.ts";
import type { Dispatch } from "./rpc/router.ts";
import type { PublicRoutes } from "./transport/hooks.ts";

export type { FlowDefinition };

/** A published drawing's agent, routine or model is no longer available to it. */
class FlowBindingChanged extends Error {}

/** The zone schedules run in: the owner's, else this machine's. */
export const flowTimeZone = (store: Store): string =>
  ownerTimeZone(store) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

export function validateFlowBinding(store: Store, flow: FlowDefinition) {
  if (!store.projects.get(flow.projectId)) throw notFound("Flow project not found");
  if (flow.action.kind === "none") return;
  const routine = flow.action.kind === "routine" ? store.routines.get(flow.action.routine) : undefined;
  if (
    flow.action.kind === "routine" &&
    (!routine || routine.project_id !== flow.projectId || routine.schedule.kind !== "manual")
  )
    throw badRequest("A Flow needs a manual-only routine in its project");
  const agent = store.agents.get(flow.action.kind === "agent" ? flow.action.agent : (routine?.agent_id ?? ""));
  if (!agent || (agent.project_id && agent.project_id !== flow.projectId))
    throw badRequest("Flow agent is outside its project");
}

/** Whether a model reference names an exact model of an active provider the owner set up. */
export type FlowModelCheck = (ref: string) => boolean;

/** Everything that keeps a graph from running in its Flow's project: its shape, its bindings and its models. */
export function flowGraphIssues(
  store: Store,
  definition: FlowDefinition,
  graph: FlowGraph,
  model: FlowModelCheck,
  outside?: FlowOutside,
): FlowGraphIssue[] {
  const issues: FlowGraphIssue[] = validateFlowGraph(graph);
  issues.push(...flowOutwardIssues(store, definition.projectId, graph, outside));
  for (const node of graph.nodes) {
    // A table renamed or removed since it was drawn stops the drawing until it names one again (DECISIONS.md#d-176).
    if ((node.kind === "table_read" || node.kind === "table_write") && node.table) {
      const table = store.flowTables.get(definition.projectId, node.table);
      if (!table)
        issues.push({ code: "table_missing", node: node.id, message: `The table ${node.table} is not in the project` });
      else if (node.kind === "table_write" && node.columns?.some((c) => !table.columns.includes(c.name)))
        issues.push({ code: "column_missing", node: node.id, message: "A column it fills is not in the table" });
    }
    try {
      if (node.kind === "agent" && !node.bot)
        validateFlowBinding(store, {
          ...definition,
          action: { kind: "agent", agent: node.agent ?? "", prompt: node.prompt },
        });
      if (node.kind === "routine")
        validateFlowBinding(store, { ...definition, action: { kind: "routine", routine: node.routine } });
    } catch {
      issues.push({
        code: "binding_unavailable",
        node: node.id,
        message: "The chosen agent or routine is not available in this project",
      });
    }
    if (node.kind === "llm" && !model(node.model))
      issues.push({ code: "model_unavailable", node: node.id, message: "The chosen model is not set up" });
    // A CLI works in the project's folder, as a code session does.
    if (node.kind === "agent" && flowEngineOf(node)) {
      const project = store.projects.get(definition.projectId);
      if (!project?.path || !project.present)
        issues.push({
          code: "folder_unavailable",
          node: node.id,
          message: "The project's folder is not on this computer",
        });
    }
    // APX's harness runs a model API the owner set up; a CLI's model is its own, checked when its session starts.
    if (node.kind === "agent" && node.model && !flowEngineOf(node) && !model(node.model.replace(/#[^#]*$/, "")))
      issues.push({ code: "model_unavailable", node: node.id, message: "The chosen model is not set up" });
  }
  return issues;
}

/**
 * Why a draft can't run yet: its steps' empty settings first (`step_incomplete`, DECISIONS.md#d-177), then, once every
 * step is complete, what `flowGraphIssues` says. What `flows.validate` and publishing check.
 */
export function flowDraftIssues(
  store: Store,
  definition: FlowDefinition,
  draft: FlowDraftGraph,
  model: FlowModelCheck,
  outside?: FlowOutside,
): FlowGraphIssue[] {
  const gaps = flowGapIssues(draft);
  return gaps.length ? gaps : flowGraphIssues(store, definition, FlowGraph.parse(draft), model, outside);
}

export function createFlows(deps: {
  store: Store;
  dispatch(): Dispatch | undefined;
  log: Log;
  /** What a graph's model steps call, and which model references are set up; absent, graphs only queue. */
  llm?: Llm | undefined;
  model?: FlowModelCheck | undefined;
  cancelThread?: ((thread: string) => void) | undefined;
  timers?: RunTimers | undefined;
  /** The office clock schedules tick on (tests set it); else the timers' or the wall's. */
  clock?: (() => Date) | undefined;
  /** Notify steps' channels; absent, a notify step can't start. */
  notifier?: FlowNotifier | undefined;
  /** What HTTP steps may reach and how they read secrets. */
  outside?: FlowOutside | undefined;
  http?: FlowHttpDeps | undefined;
  /** APX's folder: where a project without a folder of its own runs a Flow's commands. */
  home?: string | undefined;
  /** Where open screens hear of tests and of runs moving. */
  tell?: ((event: CoreEvent) => void) | undefined;
}) {
  const { store } = deps;
  const tell = deps.tell ?? (() => {});
  /** A run moved: ids and states only, the screen reads the rest. */
  const moved = (flow: string, event: string) => {
    const run = store.flowGraphRuns.load(flow, event);
    if (run)
      tell({
        type: "flow.run",
        flow,
        event,
        state: run.state,
        test: run.test,
        steps: run.graph.nodes.flatMap((n) => {
          const step = run.steps.get(n.id);
          return step ? [{ node: n.id, state: step.state }] : [];
        }),
      });
  };
  const graphs = deps.llm
    ? createFlowGraphExecutor({
        store,
        dispatch: deps.dispatch,
        llm: deps.llm,
        log: deps.log,
        cancelThread: deps.cancelThread ?? (() => {}),
        timers: deps.timers,
        notifier: deps.notifier,
        http: deps.http,
        home: deps.home,
        moved,
      })
    : undefined;
  const model = deps.model ?? (() => false);
  /** Admission checks a graph's bindings again: an agent moved or a routine changed since publishing stops it. */
  const authorize = (flow: FlowDefinition) => (graph: FlowGraph) => {
    if (flowGraphIssues(store, flow, graph, model, deps.outside).length)
      throw new FlowBindingChanged("Flow graph binding changed");
  };
  const timers = deps.timers ?? {
    now: () => Date.now(),
    after(ms: number, callback: () => void) {
      const timer = setTimeout(callback, ms);
      timer.unref?.();
      return () => clearTimeout(timer);
    },
  };
  const tests = createFlowTests({
    store,
    timers,
    now: () => api.now(),
    tell,
    kick: () => api.kick(),
    authorize: (id) => (graph) => {
      const flow = store.flows.get(id);
      if (!flow) throw new FlowBindingChanged("Flow is gone");
      authorize(flow)(graph);
    },
  });
  let closed = false;
  let running: Promise<void> | undefined;
  let requested = false;
  async function drain() {
    do {
      requested = false;
      let cursor = 0;
      while (!closed) {
        const page = store.flows.pending(20, cursor);
        if (!page.length) break;
        for (const item of page) {
          cursor = item.cursor;
          if (closed) return;
          const flow = store.flows.get(item.flow);
          if (!flow?.enabled) continue;
          try {
            const action = item.action;
            validateFlowBinding(store, { ...flow, action });
            const dispatch = deps.dispatch();
            if (!dispatch) continue;
            const ctx = {
              transport: "internal" as const,
              role: "operator" as const,
              actor: "agent" as const,
              session: undefined,
              log: deps.log,
              flowEvent: { flow: item.flow, event: item.event },
            };
            if (action.kind === "none") continue;
            if (action.kind === "routine") {
              const routine = store.routines.get(action.routine);
              if (routine?.last && !TERMINAL.has(routine.last.state)) continue;
              const result = await dispatch(
                "routines.run",
                { routine: action.routine },
                { ...ctx, actor: "human" },
                `flow:${item.flow}:${item.event}`,
              );
              if (!result.ok) throw new Error("Routine admission failed");
            } else {
              let thread = item.thread;
              if (!thread) {
                const result = await dispatch(
                  "threads.create",
                  { kind: "loose", agent_id: action.agent, project_id: flow.projectId, title: `${flow.name} · event` },
                  ctx,
                  `flow-thread:${item.flow}:${item.event}`,
                );
                if (!result.ok) throw new Error("Flow thread creation failed");
                thread = (result.result as { id: string }).id;
              }
              if (closed) return;
              if (!store.flows.get(item.flow)?.enabled) continue;
              const result = await dispatch(
                "threads.send",
                {
                  thread,
                  text: `${action.prompt}\n\nUntrusted event JSON:\n${JSON.stringify(item.payload)}`,
                  mode: "queue",
                },
                ctx,
                `flow-run:${item.flow}:${item.event}`,
              );
              if (!result.ok) throw new Error("Agent admission failed");
            }
            requested = true;
          } catch {
            // Error bodies from providers or payloads must never become Flow logs.
            store.flows.fail(item.flow, item.event);
            requested = true;
          }
        }
      }
    } while (requested && !closed);
  }
  const api = {
    /** What checks outward steps against the owner's secrets (and a test's own servers). */
    outside: deps.outside,
    /** The owner's tests with a real event (DECISIONS.md#d-178). */
    tests,
    /** The Flows' clock: injected timers in tests, the wall clock otherwise. */
    now: () => deps.clock?.() ?? new Date(deps.timers?.now() ?? Date.now()),
    /**
     * One beat of the routine scheduler (no clock of its own): each schedule Flow that is on and has a time due
     * admits one event for it, `schedule:<due time>`, however many times it missed (DECISIONS.md#d-168); one whose
     * last run is still going skips it.
     */
    tick(at: Date) {
      // Looked up only for a schedule that is on: it loads ICU data (~9 MB) a core without schedules never needs.
      let zone: string | undefined;
      let admitted = false;
      // An owner's test going doesn't make a schedule skip its time.
      const busy = new Set(
        store.flowGraphRuns
          .active()
          .filter((e) => !e.test)
          .map((e) => e.flow),
      );
      for (const s of store.flowSchedules.all()) {
        if (!s.enabled) continue;
        const since = store.flowSchedules.since(s.flow);
        if (!since) {
          store.flowSchedules.start(s.flow, at);
          continue;
        }
        let due: Date | undefined;
        try {
          zone ??= flowTimeZone(store);
          due = dueFlowTick(s.cron, new Date(since), at, zone);
        } catch {
          continue;
        }
        if (!due) continue;
        const flow = store.flows.get(s.flow);
        if (!flow) continue;
        const when = due.toISOString();
        // A run that outlasts its interval does not pile up the next ones behind it (DECISIONS.md#d-169).
        if (busy.has(s.flow)) {
          store.flowSchedules.skip(s.flow, at);
          deps.log.info({ flow: s.flow, due: when }, "a scheduled Flow time was skipped: its last run is still going");
          continue;
        }
        try {
          const state = store.tx(() => {
            store.flowSchedules.advance(s.flow, at);
            return store.flows.receive(s.flow, `schedule:${when}`, { scheduled_at: when }, authorize(flow), at, {
              source: "schedule",
              scheduledAt: when,
            });
          });
          admitted ||= state === "pending";
        } catch (err) {
          // The time is spent either way: a Flow that can't take it must not be retried every beat.
          store.flowSchedules.advance(s.flow, at);
          deps.log.warn({ flow: s.flow, err: errorMessage(err, 120) }, "a scheduled Flow run was not admitted");
        }
      }
      if (admitted) api.kick();
    },
    /**
     * The owner starts a published Flow now, through its trigger's admission: a schedule Flow with an empty event,
     * a webhook one with the sample body (untrusted data, like any POST).
     */
    runNow(id: string, data: unknown, at: Date) {
      const flow = store.flows.get(id);
      if (!flow) throw notFound("Flow not found");
      const trigger = store.flowGraphs.trigger(id);
      if (!trigger) throw conflict("Publish the drawing before running it");
      if (!flow.enabled) throw conflict("Turn the flow on to run it");
      const event = `owner:${randomUUID()}`;
      try {
        const state = store.flows.receive(id, event, trigger === "schedule" ? {} : data, authorize(flow), at, {
          source: "owner",
        });
        if (state === "pending") api.kick();
        return { event, state: state as "pending" | "ignored" | "duplicate" };
      } catch (err) {
        if (err instanceof FlowCapacityError) throw conflict("This flow has too many runs waiting");
        if (err instanceof FlowTriggerMismatch) throw conflict("This flow can't be run by hand");
        if (err instanceof FlowBindingChanged) throw conflict("The drawing can't run as it is: open it in the editor");
        throw badRequest("That body can't start a run");
      }
    },
    /** Stops a graph run that is going; owner-only through its method. */
    cancel(id: string, event: string) {
      if (!graphs) return undefined;
      return graphs.cancel(id, event);
    },
    kick() {
      graphs?.kick();
      if (closed) return;
      requested = true;
      if (!running)
        running = Promise.resolve()
          .then(drain)
          .finally(() => {
            running = undefined;
            if (requested && !closed) api.kick();
          });
    },
    async close() {
      closed = true;
      tests.close();
      await Promise.all([running, graphs?.close()]);
    },
    publicEndpoints() {
      return store.flows
        .list()
        .filter((f) => f.enabled && store.flowGraphs.trigger(f.id) !== "schedule")
        .map((f) => ({ path: `/flows/${f.path ?? f.id}`, label: f.name }));
    },
    /** `/flows/<path>`: the Flow with that address, on and started by a POST (DECISIONS.md#d-178). */
    routes: ((pathname) => {
      const path = /^\/flows\/([A-Za-z0-9_-]{1,100})$/.exec(pathname)?.[1];
      const found = path ? store.flows.byPath(path) : undefined;
      // A schedule Flow has no address: a POST to it is as unknown as one to no Flow.
      if (!found?.enabled || store.flowGraphs.trigger(found.id) === "schedule") return;
      const id = found.id;
      return {
        id: `flow:${id}`,
        methods: ["POST"],
        authorize: () => true,
        async handle(request, signal) {
          if (signal.aborted) return { status: 503 };
          const event = flowEventOf(request);
          if ("status" in event) return event;
          if (signal.aborted) return { status: 503 };
          try {
            const flow = store.flows.get(id);
            if (!flow || flow.path !== path) return { status: 404 };
            const at = new Date(deps.timers?.now() ?? Date.now());
            const headers = shownHeaders(request.headers);
            const state = store.flows.receive(id, event.id, event.data, authorize(flow), at, undefined, headers);
            if (state === "pending") api.kick();
            return { status: 202, body: { state } };
          } catch (error) {
            return {
              status: error instanceof FlowCapacityError ? 429 : 400,
              body: { error: error instanceof FlowCapacityError ? "Flow capacity exceeded" : "Invalid event" },
            };
          }
        },
      };
    }) satisfies PublicRoutes,
  };
  return api;
}
export type Flows = ReturnType<typeof createFlows>;
