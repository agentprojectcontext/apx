// "Try a run" for any drawing: the run's own planner, checks and bindings over sample data, with no effect. Steps
// that would read a table, write one, call a model or start a run are only said to run; what they would give back is
// unknown, so a step that needs it can't be told.
import type { FlowBinding, FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import {
  evaluateFlowCondition,
  type FlowNodeSnapshot,
  planFlowGraphStep,
  resolveFlowInput,
} from "./flow-graph-semantics.ts";
import { flowNodeTemplates } from "./flow-graph-validate.ts";
import { flowTemplateBindings, parseFlowTemplate, renderFlowTemplate } from "./flow-template.ts";

export type FlowTryStep = {
  node: string;
  state: "ran" | "would_run" | "skipped" | "unknown" | "missing";
  matched: boolean | null;
};

/**
 * A notify or HTTP step would run; a placeholder of the data that is absent says missing, one that needs an earlier
 * step's answer is unknown. A notify step that only sends when there is something to tell is skipped when every
 * placeholder came out empty.
 */
function outwardTry(
  node: Extract<FlowGraph["nodes"][number], { kind: "notify" | "http" }>,
  data: unknown,
  snapshots: Map<string, FlowNodeSnapshot>,
): [FlowTryStep["state"], FlowNodeSnapshot] {
  const resolve = (b: FlowBinding) => resolveFlowInput(b, data, snapshots);
  const quiet = node.kind === "notify" && node.onlyIfContent;
  let empty = true;
  for (const template of flowNodeTemplates(node)) {
    try {
      empty =
        renderFlowTemplate(parseFlowTemplate(template), resolve, { missing: quiet ? "empty" : "throw" }).empty && empty;
    } catch {
      const upstream = flowTemplateBindings(template).some((b) => b.kind === "node");
      return [upstream ? "unknown" : "missing", { state: "failed" }];
    }
  }
  if (quiet && empty) return ["skipped", { state: "skipped" }];
  return ["would_run", { state: "uncertain" }];
}

export function tryFlowGraph(graph: FlowGraph, data: unknown): FlowTryStep[] {
  const snapshots = new Map<string, FlowNodeSnapshot>(graph.nodes.map((n) => [n.id, { state: "pending" }]));
  const said = new Map<string, FlowTryStep>();
  const set = (
    node: string,
    state: FlowTryStep["state"],
    snapshot: FlowNodeSnapshot,
    matched: boolean | null = null,
  ) => {
    snapshots.set(node, snapshot);
    said.set(node, { node, state, matched });
  };
  for (let guard = 0; guard <= graph.nodes.length; guard++) {
    const decisions = planFlowGraphStep(graph, snapshots);
    if (!decisions.length) break;
    for (const d of decisions) {
      if (d.decision !== "ready") {
        // Blocked here means an earlier step's answer is unknown or missing.
        set(d.node, d.decision === "skipped" ? "skipped" : "unknown", {
          state: d.decision === "skipped" ? "skipped" : "blocked",
        });
        continue;
      }
      const node = graph.nodes.find((n) => n.id === d.node);
      if (!node) continue;
      if (node.kind === "webhook" || node.kind === "schedule") {
        set(node.id, "ran", { state: "succeeded", output: data });
        continue;
      }
      if (node.kind === "table_read") {
        // Its rows are not read: what follows from them can't be told.
        set(node.id, "would_run", { state: "uncertain" });
        continue;
      }
      if (node.kind === "notify" || node.kind === "http") {
        set(node.id, ...outwardTry(node, data, snapshots));
        continue;
      }
      let input: unknown;
      try {
        input =
          node.kind === "table_write"
            ? resolveFlowInput(node.value, data, snapshots)
            : resolveFlowInput(node.input, data, snapshots);
      } catch {
        // An unknown answer upstream, or the data lacks the field.
        const upstream = (node.kind === "table_write" ? node.value : node.input).kind === "node";
        set(node.id, upstream ? "unknown" : "missing", { state: "failed" });
        continue;
      }
      if (node.kind === "condition") {
        const out = evaluateFlowCondition(node, input);
        set(node.id, "ran", { state: "succeeded", output: out }, out.matched);
        continue;
      }
      // A step that does work: it would run, and later steps can't use its answer.
      set(
        node.id,
        "would_run",
        node.kind === "table_write" ? { state: "succeeded", output: { value: input } } : { state: "uncertain" },
      );
    }
  }
  return graph.nodes.map((n) => said.get(n.id) ?? { node: n.id, state: "unknown", matched: null });
}
