import { ErrorCode } from "@apx/protocol";
import { FlowGraphConflict, FlowGraphUnavailable } from "../domain/flow-graphs.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, CallError, conflict, notFound } from "../errors.ts";
import { type FlowOutside, flowOutward } from "../flow-outward.ts";
import { type FlowModelCheck, flowGraphIssues } from "../flows.ts";
import type { Handlers } from "./router.ts";

export function flowGraphHandlers(store: Store, model: FlowModelCheck, outside?: FlowOutside) {
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
    "flows.validate": ({ flow, project, graph }) => {
      // A Flow not saved yet is checked as one of its project, off, with nothing else defined.
      const definition =
        flow !== undefined
          ? found(flow)
          : {
              id: "new",
              projectId: project ?? "",
              name: "New",
              enabled: false,
              predicates: [],
              tableKey: "latest",
              action: { kind: "none" as const },
            };
      if (flow === undefined && !store.projects.get(definition.projectId)) throw notFound("Project not found");
      const issues = flowGraphIssues(store, definition, graph, model, outside);
      return { valid: issues.length === 0, issues };
    },
    "flows.outward": ({ flow, graph }) => {
      found(flow);
      return flowOutward(store, graph);
    },
    "flows.publish": ({ flow, expectedDraftVersion, expectedPublishedRevision, outward }) => {
      const definition = found(flow);
      return write(() =>
        store.flowGraphs.publish(flow, expectedDraftVersion, expectedPublishedRevision, (graph) => {
          const issues = flowGraphIssues(store, definition, graph, model, outside);
          if (issues.length)
            throw new CallError({
              code: ErrorCode.BadRequest,
              message: issues[0]?.message ?? "The drawing cannot run",
              detail: { issues },
            });
          // Sending as the owner and calling other services is approved by publishing what the owner was shown.
          const { keys } = flowOutward(store, graph);
          if (keys.length && JSON.stringify([...new Set(outward ?? [])].sort()) !== JSON.stringify(keys))
            throw conflict("Confirm where it sends and what it calls before it runs", {
              reason: "outward_unconfirmed",
              keys,
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
