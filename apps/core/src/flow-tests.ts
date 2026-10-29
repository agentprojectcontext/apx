// An owner's test of a Flow with a real event (DECISIONS.md#d-178): while they listen, `/flows/test/<path>` takes one
// POST, checked as the Flow's own address checks it, and runs the drawing pinned when they started. Not listening, it
// runs nothing. Listening lives in memory: a restart stops it, and nothing waits or ticks while nobody listens.
import { randomUUID } from "node:crypto";
import type { CoreEvent } from "@apx/protocol";
import { hookMethods } from "../../../packages/protocol/src/flow-edit.ts";
import type { FlowGraph } from "../../../packages/protocol/src/flow-graph.ts";
import type { HookRequest, HookResponse } from "./channels/types.ts";
import { FlowCapacityError } from "./domain/flow-events.ts";
import type { FlowEventSource } from "./domain/flow-graphs.ts";
import type { Store } from "./domain/store.ts";
import type { RunTimers } from "./engine/engine.ts";
import { conflict } from "./errors.ts";
import type { PublicRoutes } from "./transport/hooks.ts";

/** How long a test waits for its event. */
export const FLOW_TEST_MS = 5 * 60_000;
/** Flows waiting for a test at once. */
const MAX_LISTENING = 16;
/** Headers a test's log shows: what the sender said it sent, never a key. */
const SHOWN = ["content-type", "content-length", "user-agent", "idempotency-key"];

/**
 * The event a Flow's address takes, or the answer that refuses it: a POST's body `{"id": "...", "data": ...}` in JSON;
 * a GET's query, its `id` parameter as the event's id (a new one when it has none) and the rest as `data`.
 */
export function flowEventOf(request: HookRequest): { id: string; data: unknown } | HookResponse {
  if (request.method === "GET") return queryEvent(request.query ?? "");
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
    return { id: event.id, data: event.data };
  } catch {
    return { status: 400 };
  }
}

/** A GET's parameters as data: one value is text, a repeated one a list. */
function queryEvent(query: string): { id: string; data: Record<string, string | string[]> } | HookResponse {
  const data: Record<string, string | string[]> = Object.create(null);
  let id: string | undefined;
  try {
    for (const [key, value] of new URLSearchParams(query)) {
      if (key === "id") id ??= value;
      else if (["__proto__", "constructor", "prototype"].includes(key) || key.length > 128) return { status: 400 };
      else {
        const had = data[key];
        data[key] = had === undefined ? value : [...(Array.isArray(had) ? had : [had]), value];
      }
    }
  } catch {
    return { status: 400 };
  }
  if (id !== undefined && (!id || id.length > 200)) return { status: 400 };
  return { id: id ?? `get:${randomUUID()}`, data: { ...data } };
}

/** The headers worth showing with what arrived, each cut to 200 characters. */
export function shownHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(SHOWN.filter((h) => headers[h]).map((h) => [h, (headers[h] ?? "").slice(0, 200)]));
}

/** Whether the Flow's own address has a key, and whether these headers carry it. */
export type FlowKeys = { has(path: string): boolean; verify(path: string, headers: Record<string, string>): boolean };

export function createFlowTests(deps: {
  store: Store;
  timers: RunTimers;
  now: () => Date;
  tell: (event: CoreEvent) => void;
  kick: () => void;
  /** Checks a drawing's bindings again when its event arrives, as admission does. */
  authorize: (flow: string) => (graph: FlowGraph) => void;
}) {
  const { store, tell } = deps;
  const listening = new Map<string, { until: number; revision: number; graph: string; disarm: () => void }>();
  const said = (flow: string, state: "listening" | "stopped" | "expired" | "received" | "refused", more = {}) =>
    tell({ type: "flow.test", flow, state, until: null, event: null, ...more });
  const drop = (flow: string) => {
    const l = listening.get(flow);
    l?.disarm();
    listening.delete(flow);
    return l;
  };
  const admit = (
    flow: string,
    pinned: { revision: number; graph: string },
    data: unknown,
    from: FlowEventSource,
    headers?: Record<string, string>,
  ) => {
    const event = `test:${randomUUID()}`;
    const { state } = store.flowGraphs.admitTest(
      flow,
      event,
      data,
      deps.now(),
      pinned,
      deps.authorize(flow),
      from,
      headers,
    );
    return { event, state };
  };
  const api = {
    /**
     * Waits for one event to the Flow's test address, on this test revision (`graph`: its text, checked again when the
     * event comes); a test already waiting is replaced.
     */
    listen(flow: string, revision: number, graph: string): Date {
      if (!listening.has(flow) && listening.size >= MAX_LISTENING)
        throw conflict("Too many tests are waiting; stop one first");
      drop(flow);
      const until = deps.now().getTime() + FLOW_TEST_MS;
      const disarm = deps.timers.after(FLOW_TEST_MS, () => {
        if (listening.get(flow)?.until !== until) return;
        listening.delete(flow);
        said(flow, "expired");
      });
      listening.set(flow, { until, revision, graph, disarm });
      said(flow, "listening", { until: new Date(until).toISOString() });
      return new Date(until);
    },
    /** A schedule Flow's test: one run now, with no data, as its schedule would start it. */
    runNow(flow: string, revision: number, graph: string) {
      const { event, state } = admit(flow, { revision, graph }, {}, { source: "owner" });
      if (state === "pending") deps.kick();
      return event;
    },
    stop(flow: string): boolean {
      if (!drop(flow)) return false;
      said(flow, "stopped");
      return true;
    },
    /** When a Flow's test stops waiting, if it is waiting. */
    until(flow: string): Date | undefined {
      const l = listening.get(flow);
      return l && l.until > deps.now().getTime() ? new Date(l.until) : undefined;
    },
    close() {
      for (const flow of [...listening.keys()]) drop(flow);
    },
    /**
     * `/flows/test/<path>`: one POST while its Flow listens, with the key its address asks for once it has one, the
     * same body and caps. Not listening it is no route at all: the listener's bare 404, with no body read, whether or
     * not a Flow has that path.
     */
    routes(keys: FlowKeys): PublicRoutes {
      return (pathname) => {
        const path = /^\/flows\/test\/([A-Za-z0-9_-]{1,100})$/.exec(pathname)?.[1];
        if (!path) return;
        const waiting = store.flows.byPath(path);
        if (!waiting || !api.until(waiting.id)) return;
        const address = `/flows/${path}`;
        const pinned = listening.get(waiting.id);
        return {
          id: `flow-test:${waiting.id}`,
          methods: pinned ? hookMethods(JSON.parse(pinned.graph) as FlowGraph) : ["POST"],
          authorize: (headers) => !keys.has(address) || keys.verify(address, headers),
          async handle(request, signal) {
            if (signal.aborted) return { status: 503 };
            const l = listening.get(waiting.id);
            // Stopped, out of time or renamed while the body came: nothing waits here any more.
            if (!l || l.until <= deps.now().getTime() || store.flows.get(waiting.id)?.path !== path)
              return { status: 404, body: { error: "No test is waiting at this address" } };
            const parsed = flowEventOf(request);
            if ("status" in parsed) return parsed;
            if (signal.aborted) return { status: 503 };
            // One event: taken before admission, so a second POST racing it finds nothing waiting.
            drop(waiting.id);
            try {
              const r = admit(waiting.id, l, parsed.data, { source: "webhook" }, shownHeaders(request.headers));
              // Heard before its first step moves, so the editor knows which run to follow.
              said(waiting.id, "received", { event: r.event });
              if (r.state === "pending") deps.kick();
              return { status: 202, body: { state: r.state } };
            } catch (error) {
              said(waiting.id, "refused");
              return error instanceof FlowCapacityError
                ? { status: 429, body: { error: "Flow capacity exceeded" } }
                : { status: 409, body: { error: "The flow can't run this event as it is" } };
            }
          },
        };
      };
    },
  };
  return api;
}
export type FlowTests = ReturnType<typeof createFlowTests>;
