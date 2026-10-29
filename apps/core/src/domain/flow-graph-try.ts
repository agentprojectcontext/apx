// "Try a run" for any drawing: the run's own planner, checks, variables and bindings over sample data, with no effect.
// Steps that would read a table, write one, call a model, run code or a command, query a database or start a run are
// only said to run; what they would give back is unknown, so a step that needs it can't be told.

import type { FlowBinding, FlowGraph } from "../../../../packages/protocol/src/flow-graph.ts";
import type { FlowVarIndex } from "./flow-expr.ts";
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
} from "./flow-graph-semantics.ts";
import { flowNodeBindings, flowNodeTemplates } from "./flow-graph-validate.ts";
import { flowRowCells } from "./flow-table-cells.ts";
import { flowTemplateBindings, parseFlowTemplate, renderFlowTemplate } from "./flow-template.ts";

export type FlowTryStep = {
  node: string;
  state: "ran" | "would_run" | "skipped" | "unknown" | "missing";
  matched: boolean | null;
  branch: string | null;
};

/**
 * A notify or HTTP step would run; a placeholder of the data that is absent says missing, one that needs an earlier
 * step's answer is unknown. A notify step that only sends when there is something to tell is skipped when every
 * placeholder came out empty.
 */
function outwardTry(
  node: Extract<FlowGraph["nodes"][number], { kind: "notify" | "http" | "sql" | "cmd" }>,
  data: unknown,
  snapshots: Map<string, FlowNodeSnapshot>,
  vars: FlowVarIndex,
): [FlowTryStep["state"], FlowNodeSnapshot] {
  const resolve = (b: FlowBinding) => resolveFlowInput(b, data, snapshots);
  const quiet = node.kind === "notify" && node.onlyIfContent;
  let empty = true;
  for (const template of flowNodeTemplates(node)) {
    try {
      empty =
        renderFlowTemplate(parseFlowTemplate(template, vars), resolve, { missing: quiet ? "empty" : "throw" }).empty &&
        empty;
    } catch {
      return [unknownOrMissing(flowTemplateBindings(template, vars), snapshots), { state: "failed" }];
    }
  }
  if (quiet && empty) return ["skipped", { state: "skipped" }];
  return ["would_run", { state: "uncertain" }];
}

/** An answer of an earlier step that isn't known yet makes it unknown; a field the data lacks, missing. */
const unknownOrMissing = (reads: FlowBinding[], snapshots: Map<string, FlowNodeSnapshot>): FlowTryStep["state"] =>
  reads.some((b) => b.kind === "node" && snapshots.get(b.node)?.state !== "succeeded") ? "unknown" : "missing";

export function tryFlowGraph(graph: FlowGraph, data: unknown): FlowTryStep[] {
  const snapshots = new Map<string, FlowNodeSnapshot>(graph.nodes.map((n) => [n.id, { state: "pending" }]));
  const said = new Map<string, FlowTryStep>();
  const vars = flowVarIndex(graph);
  const reads = { resolve: (b: FlowBinding) => resolveFlowInput(b, data, snapshots), vars };
  const set = (node: string, state: FlowTryStep["state"], snapshot: FlowNodeSnapshot, branch: string | null = null) => {
    snapshots.set(node, snapshot);
    said.set(node, { node, state, matched: branch === null ? null : branch !== FLOW_OTHERWISE, branch });
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
      if (node.kind === "notify" || node.kind === "http" || node.kind === "sql" || node.kind === "cmd") {
        set(node.id, ...outwardTry(node, data, snapshots, vars));
        continue;
      }
      if (node.kind === "vars" || node.kind === "condition") {
        try {
          const equals = node.kind === "condition" && flowCases(node).some((c) => c.match.kind === "equals");
          const input = equals ? resolveFlowInput(node.input, data, snapshots) : null;
          if (node.kind === "vars") set(node.id, "ran", { state: "succeeded", output: evaluateFlowVars(node, reads) });
          else {
            const out = evaluateFlowCondition(node, input, reads);
            set(node.id, "ran", { state: "succeeded", output: out }, conditionBranch(out));
          }
        } catch {
          set(node.id, unknownOrMissing(flowNodeBindings(node, vars), snapshots), { state: "failed" });
        }
        continue;
      }
      let input: unknown;
      try {
        input =
          node.kind === "table_write"
            ? node.columns
              ? flowRowCells(node.columns, reads)
              : resolveFlowInput(node.value ?? { kind: "event", path: [] }, data, snapshots)
            : resolveFlowInput(node.input, data, snapshots);
      } catch {
        // An unknown answer upstream, or the data lacks the field.
        const upstream = (node.kind === "table_write" ? node.value : node.input)?.kind === "node";
        set(node.id, upstream ? "unknown" : "missing", { state: "failed" });
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
  return graph.nodes.map((n) => said.get(n.id) ?? { node: n.id, state: "unknown", matched: null, branch: null });
}
