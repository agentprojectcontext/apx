import type { FlowBinding, FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";

export type NodeKind = FlowNode["kind"];
export function newNode(kind: NodeKind, id: string, label: string): FlowNode {
  const input: FlowBinding = { kind: "event", path: [] };
  switch (kind) {
    case "webhook":
      return { id, label, kind };
    case "condition":
      return { id, label, kind, input, equals: "" };
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
  if (graph.nodes.find((n) => n.id === target)?.kind === "webhook") return "trigger";
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
export function connectNodes(graph: FlowGraph, source: string, target: string): FlowGraph {
  if (connectionError(graph, source, target)) return graph;
  return { ...graph, edges: [...graph.edges, { source, target }] };
}
export function moveNode(graph: FlowGraph, id: string, x: number, y: number): FlowGraph {
  const point = { node: id, x: Math.max(-100000, Math.min(100000, x)), y: Math.max(-100000, Math.min(100000, y)) };
  return { ...graph, layout: [...graph.layout.filter((p) => p.node !== id), point] };
}
