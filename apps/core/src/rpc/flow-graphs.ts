import { ErrorCode } from "@apx/protocol";
import { FlowGraphConflict, FlowGraphUnavailable } from "../domain/flow-graphs.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, CallError, conflict, notFound } from "../errors.ts";
import { type FlowModelCheck, flowGraphIssues } from "../flows.ts";
import type { Handlers } from "./router.ts";

export function flowGraphHandlers(store: Store, model: FlowModelCheck) {
  const found = (id: string) => {
    const flow = store.flows.get(id);
    if (!flow) throw notFound("Flow not found");
    return flow;
  };
  const write = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      if (error instanceof CallError) throw error;
      if (error instanceof FlowGraphUnavailable)
        throw conflict(error.message, { reason: "graph_execution_unavailable" });
      if (error instanceof FlowGraphConflict) throw conflict(error.message);
      throw badRequest("Invalid Flow graph, binding or capacity exceeded");
    }
  };
  return {
    "flows.graph_get": ({ flow }) => {
      found(flow);
      return store.flowGraphs.get(flow);
    },
    "flows.draft_save": ({ flow, expectedVersion, graph }) => {
      found(flow);
      return write(() => store.flowGraphs.saveDraft(flow, expectedVersion, graph));
    },
    "flows.draft_discard": ({ flow, expectedVersion }) => {
      found(flow);
      return write(() => store.flowGraphs.discardDraft(flow, expectedVersion));
    },
    "flows.validate": ({ flow, graph }) => {
      const issues = flowGraphIssues(store, found(flow), graph, model);
      return { valid: issues.length === 0, issues };
    },
    "flows.publish": ({ flow, expectedDraftVersion, expectedPublishedRevision }) => {
      const definition = found(flow);
      return write(() =>
        store.flowGraphs.publish(flow, expectedDraftVersion, expectedPublishedRevision, (graph) => {
          const issues = flowGraphIssues(store, definition, graph, model);
          if (issues.length)
            throw new CallError({
              code: ErrorCode.BadRequest,
              message: issues[0]?.message ?? "The drawing cannot run",
              detail: { issues },
            });
        }),
      );
    },
    "flows.run_get": ({ flow, event }) => {
      found(flow);
      const run = store.flowGraphRuns.detail(flow, event);
      if (!run) throw notFound("Flow run");
      return run;
    },
  } satisfies Partial<Handlers>;
}
