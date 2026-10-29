import { FLOW_OTHERWISE, flowBranches, flowCases } from "@apx/protocol/flow-cases";
import type { FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";

type Condition = Extract<FlowNode, { kind: "condition" }>;

// The edits an agent's tool makes too live in the protocol package, so both draw alike.
export { connectionError, connectNodes, newNode, removeNode } from "@apx/protocol/flow-edit";
export type NodeKind = FlowNode["kind"];

/** A check in the form that has cases: one drawn before them keeps its value as its "yes" case. */
export function withCases(n: Condition): Condition & { cases: NonNullable<Condition["cases"]> } {
  const { equals: _, ...rest } = n;
  return { ...rest, cases: flowCases(n) };
}

/** A new case's id: c2, c3… never "yes", "no" or one it has. */
export function nextCaseId(n: Condition): string {
  const taken = new Set(flowBranches(n));
  for (let i = 2; ; i++) if (!taken.has(`c${i}`)) return `c${i}`;
}

/** A check whose case was removed: the connections that left by it are removed too. */
export function removeCase(graph: FlowGraph, check: string, id: string): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === check && n.kind === "condition"
        ? { ...withCases(n), cases: flowCases(n).filter((c) => c.id !== id) }
        : n,
    ),
    edges: graph.edges.filter((e) => !(e.source === check && (e.when ?? "yes") === id)),
  };
}
export { FLOW_OTHERWISE };
export function moveNode(graph: FlowGraph, id: string, x: number, y: number): FlowGraph {
  const point = { node: id, x: Math.max(-100000, Math.min(100000, x)), y: Math.max(-100000, Math.min(100000, y)) };
  return { ...graph, layout: [...graph.layout.filter((p) => p.node !== id), point] };
}

/** A run starts at its one trigger: an incoming POST or a schedule. */
export const isTrigger = (kind: string): kind is "webhook" | "schedule" => kind === "webhook" || kind === "schedule";

/** A field path as people write it: form.tier. */
export const dotted = (path: readonly string[]) => path.join(".");

/** Steps in the order they run: along the path from the trigger, then any step not on it. */
export function chainOrder(graph: FlowGraph): FlowNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: FlowNode[] = [];
  const visit = (n: FlowNode | undefined) => {
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
    for (const e of graph.edges) if (e.source === n.id) visit(byId.get(e.target));
  };
  for (const n of graph.nodes) if (isTrigger(n.kind)) visit(n);
  for (const n of graph.nodes) visit(n);
  return out;
}
