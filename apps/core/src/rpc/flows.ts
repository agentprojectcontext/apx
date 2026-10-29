import { sameShape, shapeOfDefinition, shapeOfGraph } from "@apx/protocol/flow-shape";
import { matchesFlowPredicates } from "../domain/flow-evaluate.ts";
import { flowDraftOrder, flowGraphOrder } from "../domain/flow-graph-semantics.ts";
import { tryFlowGraph } from "../domain/flow-graph-try.ts";
import { validateFlowGraph } from "../domain/flow-graph-validate.ts";
import { FlowGraphUnavailable } from "../domain/flow-graphs.ts";
import { nextFlowTick } from "../domain/flow-schedules.ts";
import { flowCronProblem } from "../domain/schedule.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { type FlowModelCheck, type Flows, flowGraphIssues, flowTimeZone, validateFlowBinding } from "../flows.ts";
import { flowGraphHandlers } from "./flow-graphs.ts";
import type { Handlers } from "./router.ts";
import { tableHandlers } from "./tables.ts";

export function flowHandlers(
  store: Store,
  flows: Flows,
  credentials: import("../public-credentials.ts").PublicCredentials,
  model: FlowModelCheck,
  bus?: import("../bus.ts").Bus,
) {
  const flowsNow = () => flows.now();
  const graphHandlers = flowGraphHandlers(store, model, flows.outside, bus);
  const found = (id: string) => {
    const flow = store.flows.get(id);
    if (!flow) throw notFound("Flow not found");
    return flow;
  };
  return {
    ...graphHandlers,
    ...tableHandlers(store),
    "flows.publish": (params, ctx) => {
      const scheduleOf = () => store.flowGraphs.get(params.flow).published?.nodes.find((n) => n.kind === "schedule");
      const before = JSON.stringify(scheduleOf() ?? null);
      const doc = graphHandlers["flows.publish"](params, ctx);
      // A new schedule (or a trigger changed) owes nothing from the old one's count; off, it keeps none.
      if (JSON.stringify(scheduleOf() ?? null) !== before) {
        if (store.flows.get(params.flow)?.enabled) store.flowSchedules.reset(params.flow, flowsNow());
        else store.flowSchedules.stop(params.flow);
      }
      return doc;
    },
    "flows.create": (params, ctx) => {
      const made = graphHandlers["flows.create"](params, ctx);
      // A new identifier never inherits a route credential left by a Flow of a deleted project.
      credentials.revoke(`/flows/${made.flow.id}`);
      return made;
    },
    "flows.list": ({ project }) => {
      const flows = store.flows.list(project);
      const published: Record<string, { revision: number; kinds: string[] }> = {};
      const schedules: Record<
        string,
        { cron: string; next_at: string | null; skipped: number; skipped_at: string | null }
      > = {};
      const zone = flowTimeZone(store);
      const at = flowsNow();
      const drafts: Record<string, { version: number; kinds: string[] }> = {};
      for (const f of flows) {
        const doc = store.flowGraphs.get(f.id);
        // A draft that is not what runs is what the list shows (an old definition's own drawing runs as it is).
        if (doc.draft && doc.draftVersion !== null) {
          const shape = doc.published ? undefined : shapeOfGraph(doc.draft);
          if (!shape?.ok || !sameShape(shape.shape, shapeOfDefinition(f)))
            drafts[f.id] = { version: doc.draftVersion, kinds: flowDraftOrder(doc.draft).map((n) => n.kind) };
        }
        if (!doc.published || doc.publishedRevision === null) continue;
        published[f.id] = {
          revision: doc.publishedRevision,
          kinds: flowGraphOrder(doc.published).map((n) => n.kind),
        };
        const trigger = doc.published.nodes.find((n) => n.kind === "schedule");
        if (trigger?.kind === "schedule")
          schedules[f.id] = {
            cron: trigger.cron,
            next_at: f.enabled ? (nextFlowTick(trigger.cron, at, zone)?.toISOString() ?? null) : null,
            ...store.flowSchedules.skips(f.id),
          };
      }
      return { flows, published, drafts, schedules, time_zone: zone };
    },
    "flows.set": (flow) => {
      const previous = store.flows.get(flow.id);
      if (previous && previous.projectId !== flow.projectId) throw badRequest("Flow belongs to another project");
      // A published Flow runs its drawing: its old definition is history, and turning it on checks the drawing.
      const published = previous ? store.flowGraphs.get(flow.id).published : null;
      if (published) {
        if (flow.enabled && flowGraphIssues(store, flow, published, model, flows.outside).length)
          throw badRequest("The drawing can't run as it is: open it in the editor to fix it");
      } else validateFlowBinding(store, flow);
      try {
        if (!previous) credentials.revoke(`/flows/${flow.id}`);
        const saved = store.flows.save(flow);
        // Turned on, a schedule counts from now: its next time is the first owed, even within the scheduler's beat.
        if (saved.enabled && !previous?.enabled && store.flowGraphs.trigger(flow.id) === "schedule")
          store.flowSchedules.reset(flow.id, flowsNow());
        flows.kick();
        return saved;
      } catch (error) {
        if (error instanceof FlowGraphUnavailable)
          throw badRequest("This flow runs its drawing: change it in the editor");
        throw badRequest("Invalid Flow definition or capacity exceeded");
      }
    },
    "flows.rows": ({ flow, limit, cursor }) => {
      found(flow);
      return store.flows.rowsPage(flow, limit, cursor);
    },
    "flows.write": ({ flow, key, value }) => {
      found(flow);
      try {
        return store.flows.write(flow, key, value);
      } catch {
        throw badRequest("Invalid Flow row or capacity exceeded");
      }
    },
    "flows.events": ({ flow, limit, cursor }) => {
      found(flow);
      return store.flows.eventsPage(flow, limit, cursor);
    },
    "flows.retire": ({ flow }) => {
      let result: { retired: boolean };
      try {
        result = store.flows.retire(flow);
      } catch {
        throw badRequest(
          "Disable the Flow, let its runs end and publish or discard unpublished changes before retiring it; the identifier stays reserved",
        );
      }
      try {
        credentials.revoke(`/flows/${flow}`);
      } catch {
        throw badRequest("Flow data is absent, but credential cleanup failed; retry retirement to finish cleanup");
      }
      return result;
    },
    "flows.try": ({ predicates, data }) => {
      const text = JSON.stringify(data);
      if (text === undefined || Buffer.byteLength(text) > 32768) throw badRequest("Sample data exceeds 32 KiB");
      // Same rule as admission: only a nonempty object can match.
      const object = data !== null && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length > 0;
      try {
        return { matches: object && matchesFlowPredicates(data, predicates) };
      } catch {
        throw badRequest("Invalid Flow checks");
      }
    },
    "flows.next_runs": ({ cron }) => {
      const zone = flowTimeZone(store);
      const error = flowCronProblem(cron) ?? null;
      const next: string[] = [];
      let at = flowsNow();
      while (!error && next.length < 3) {
        const n = nextFlowTick(cron, at, zone);
        if (!n) break;
        next.push(n.toISOString());
        at = n;
      }
      return { next, time_zone: zone, error };
    },
    "flows.run_now": ({ flow, data }) => {
      found(flow);
      return flows.runNow(flow, data ?? {}, flowsNow());
    },
    "flows.cancel_run": ({ flow, event }) => {
      found(flow);
      const state = flows.cancel(flow, event) ?? null;
      return { cancelled: state !== null, state };
    },
    "flows.try_graph": ({ graph, data }) => {
      const text = JSON.stringify(data);
      if (text === undefined || Buffer.byteLength(text) > 32768) throw badRequest("Sample data exceeds 32 KiB");
      if (validateFlowGraph(graph).length) throw badRequest("The drawing can't run as it is");
      try {
        return { steps: tryFlowGraph(graph, data) };
      } catch {
        throw badRequest("That sample can't be tried");
      }
    },
    "flows.retry": ({ flow, event }) => {
      found(flow);
      const result = store.flows.retry(flow, event);
      flows.kick();
      return result;
    },
  } satisfies Partial<Handlers>;
}
