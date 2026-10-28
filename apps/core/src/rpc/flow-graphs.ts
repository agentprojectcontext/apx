import type { FlowGraph, FlowGraphIssue } from "../../../../packages/protocol/src/flow-graph.ts";
import { validateFlowGraph } from "../domain/flow-graph-validate.ts";
import { FlowGraphConflict, FlowGraphUnavailable } from "../domain/flow-graphs.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, notFound } from "../errors.ts";
import { validateFlowBinding } from "../flows.ts";
import type { Handlers } from "./router.ts";

export function flowGraphHandlers(store: Store) {
  const found = (id: string) => {
    const flow = store.flows.get(id);
    if (!flow) throw notFound("Flow not found");
    return flow;
  };
  const validate = (flow: string, graph: FlowGraph) => {
    const definition = found(flow);
    const issues: FlowGraphIssue[] = validateFlowGraph(graph);
    for (const node of graph.nodes) {
      try {
        if (node.kind === "agent")
          validateFlowBinding(store, {
            ...definition,
            action: { kind: "agent", agent: node.agent, prompt: node.prompt },
          });
        if (node.kind === "routine")
          validateFlowBinding(store, { ...definition, action: { kind: "routine", routine: node.routine } });
        if (node.kind === "llm")
          issues.push({
            code: "llm_execution_unavailable",
            node: node.id,
            message: "LLM nodes cannot be published until graph execution and provider validation are available",
          });
      } catch {
        issues.push({
          code: "binding_unavailable",
          node: node.id,
          message: "The configured action or model is unavailable in this project",
        });
      }
    }
    return { valid: issues.length === 0, issues };
  };
  const write = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
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
    "flows.validate": ({ flow, graph }) => validate(flow, graph),
    "flows.publish": ({ flow }) => {
      found(flow);
      return write(() => store.flowGraphs.publish(flow));
    },
  } satisfies Partial<Handlers>;
}
