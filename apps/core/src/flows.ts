import type { FlowDefinition } from "../../../packages/protocol/src/flow-methods.ts";
import { FlowCapacityError } from "./domain/flows.ts";
import { TERMINAL } from "./domain/runs.ts";
import type { Store } from "./domain/store.ts";
import { badRequest, notFound } from "./errors.ts";
import type { Log } from "./log.ts";
import type { Dispatch } from "./rpc/router.ts";
import type { PublicRoutes } from "./transport/hooks.ts";

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

export function createFlows(deps: { store: Store; dispatch(): Dispatch | undefined; log: Log }) {
  const { store } = deps;
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
    kick() {
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
      await running;
    },
    publicEndpoints() {
      return store.flows
        .list()
        .filter((f) => f.enabled)
        .map((f) => ({ path: `/flows/${f.id}`, label: f.name }));
    },
    routes: ((pathname) => {
      const id = /^\/flows\/([A-Za-z0-9_-]{1,128})$/.exec(pathname)?.[1];
      if (!id || !store.flows.get(id)?.enabled) return;
      return {
        id: `flow:${id}`,
        methods: ["POST"],
        authorize: () => true,
        async handle(request, signal) {
          if (signal.aborted) return { status: 503 };
          if (request.body.length > 65536) return { status: 413 };
          if (!request.headers["content-type"]?.startsWith("application/json")) return { status: 415 };
          try {
            const body: unknown = JSON.parse(request.body.toString("utf8"));
            if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400 };
            const event = body as Record<string, unknown>;
            if (
              Object.keys(event).some((key) => key !== "id" && key !== "data") ||
              typeof event.id !== "string" ||
              !Object.hasOwn(event, "data")
            )
              return { status: 400 };
            if (signal.aborted) return { status: 503 };
            const state = store.flows.receive(id, event.id, event.data);
            api.kick();
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
