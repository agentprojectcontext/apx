import { FLOW_OTHERWISE, flowBranches, flowCases } from "@apx/protocol/flow-cases";
import type { FlowBinding, FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";

type Condition = Extract<FlowNode, { kind: "condition" }>;

export type NodeKind = FlowNode["kind"];
export function newNode(kind: NodeKind, id: string, label: string): FlowNode {
  const input: FlowBinding = { kind: "event", path: [] };
  switch (kind) {
    case "webhook":
      return { id, label, kind };
    case "schedule":
      return { id, label, kind, cron: "30 8 * * 1-5" };
    case "condition":
      // The two-case default: "yes" when its expression holds, else "no".
      return { id, label, kind, input, cases: [{ id: "yes", label: "", match: { kind: "expr", expr: "" } }] };
    case "vars":
      return { id, label, kind, vars: [{ name: "value", value: { kind: "literal", value: "" } }] };
    case "js":
      return { id, label, kind, code: "return input;", input, timeoutMs: 2000 };
    case "sql":
      return {
        id,
        label,
        kind,
        database: "",
        mode: "read",
        query: "SELECT * FROM ",
        params: [],
        maxRows: 50,
        timeoutMs: 10000,
      };
    case "cmd":
      return { id, label, kind, command: "", env: [], stdin: "", timeoutMs: 30000, continueOnError: false };
    case "table_read":
      return { id, label, kind, keys: [""] };
    case "table_write":
      return { id, label, kind, key: "", value: input };
    case "llm":
      return { id, label, kind, model: "", prompt: "", input, maxOutputTokens: 1024, timeoutMs: 30000 };
    case "agent":
      return { id, label, kind, agent: "", prompt: "", input };
    case "routine":
      return { id, label, kind, routine: "", input };
    case "notify":
      return { id, label, kind, channel: "", to: { kind: "contact", person: "" }, text: "", onlyIfContent: false };
    case "http":
      return { id, label, kind, method: "POST", url: "https://", headers: [], body: "", timeoutMs: 10000 };
  }
}
export function removeNode(graph: FlowGraph, id: string): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.source !== id && e.target !== id),
    layout: graph.layout.filter((p) => p.node !== id),
  };
}
export function connectionError(graph: FlowGraph, source: string, target: string): string | null {
  if (!graph.nodes.some((n) => n.id === source) || !graph.nodes.some((n) => n.id === target)) return "missing";
  if (source === target) return "self";
  const into = graph.nodes.find((n) => n.id === target)?.kind;
  if (into === "webhook" || into === "schedule") return "trigger";
  if (graph.edges.some((e) => e.source === source && e.target === target)) return "duplicate";
  if (graph.edges.length >= 64) return "limit";
  const seen = new Set<string>();
  const pending = [target];
  while (pending.length) {
    const id = pending.pop();
    if (!id || seen.has(id)) continue;
    if (id === source) return "cycle";
    seen.add(id);
    pending.push(...graph.edges.filter((e) => e.source === id).map((e) => e.target));
  }
  return null;
}
/** Joins two steps; out of a check, `when` says by which way out (its first case unless another is named). */
export function connectNodes(graph: FlowGraph, source: string, target: string, when?: string): FlowGraph {
  if (connectionError(graph, source, target)) return graph;
  const check = graph.nodes.find((n): n is Condition => n.id === source && n.kind === "condition");
  const branch = check && (when && flowBranches(check).includes(when) ? when : flowBranches(check)[0]);
  return { ...graph, edges: [...graph.edges, { source, target, ...(branch ? { when: branch } : {}) }] };
}

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

/** `node` placed just before `target`: what led into the target now leads into it, and it leads into the target. */
export function insertBefore(graph: FlowGraph, target: string, node: FlowNode): FlowGraph {
  const at = graph.layout.find((p) => p.node === target);
  return {
    ...graph,
    nodes: [...graph.nodes, node],
    edges: [
      ...graph.edges.map((e) => (e.target === target ? { ...e, target: node.id } : e)),
      { source: node.id, target },
    ],
    layout: [...graph.layout, { node: node.id, x: at?.x ?? 0, y: (at?.y ?? 0) + 140 }],
  };
}
