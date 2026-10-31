import { FLOW_OTHERWISE, flowBranches, flowCases } from "@apx/protocol/flow-cases";
import type { FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import type { MessageKey } from "../i18n/index.ts";

type Condition = Extract<FlowNode, { kind: "condition" }>;
type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

// The edits an agent's tool makes too live in the protocol package, so both draw alike.
export { connectionError, connectNodes, disconnectNodes, newNode, removeNode } from "@apx/protocol/flow-edit";
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

/**
 * A check's ways out, named for the person: a case by its name, else "Yes" for the first and "Case 2"… for the
 * others; otherwise is "No" beside one case and "Otherwise" beside more.
 */
export function branchesOf(n: Condition, t: T): { id: string; label: string }[] {
  const cases = flowCases(n);
  return [
    ...cases.map((c, i) => ({
      id: c.id,
      label: c.label.trim() || (i === 0 ? t("flow.f.yes") : t("flow.f.caseN", { n: i + 1 })),
    })),
    { id: FLOW_OTHERWISE, label: cases.length === 1 ? t("flow.f.no") : t("flow.f.otherwise") },
  ];
}

/** The methods a webhook step takes, as its card and run log show them. */
export const hookVerbs = (n: Extract<FlowNode, { kind: "webhook" }>) => (n.methods ?? ["POST"]).join(", ");

/** A value as typed in a check or a variable: text quoted, anything else as it is. */
export const literal = (v: string | number | boolean | null) => (typeof v === "string" ? `"${v}"` : String(v));
