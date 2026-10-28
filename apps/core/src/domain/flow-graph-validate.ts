import {
  type FlowBinding,
  FlowGraph,
  type FlowGraphIssue,
  type FlowNode,
} from "../../../../packages/protocol/src/flow-graph.ts";

export function flowNodeBindings(node: FlowNode): FlowBinding[] {
  if (node.kind === "condition" || node.kind === "llm" || node.kind === "agent" || node.kind === "routine")
    return [node.input];
  return node.kind === "table_write" ? [node.value] : [];
}

export function validateFlowGraph(value: FlowGraph): FlowGraphIssue[] {
  const graph = FlowGraph.parse(value);
  const issues: FlowGraphIssue[] = [];
  const add = (code: string, message: string, node?: string) =>
    issues.push({ code, message, ...(node ? { node } : {}) });
  if (Buffer.byteLength(JSON.stringify(graph)) > 131072) add("graph_size", "Graph exceeds 128 KiB");
  const nodes = new Map<string, FlowNode>();
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) add("duplicate_node", "Node identifiers must be unique", node.id);
    nodes.set(node.id, node);
  }
  const triggers = graph.nodes.filter((node) => node.kind === "webhook");
  if (triggers.length !== 1) add("trigger_count", "A graph needs exactly one webhook trigger");
  if (graph.nodes.filter((node) => node.kind === "llm").length > 4)
    add("model_limit", "A graph supports at most four LLM nodes");
  const parents = new Map<string, Set<string>>([...nodes.keys()].map((id) => [id, new Set()]));
  const edges = new Set<string>();
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      add("unknown_endpoint", "Connection refers to an unknown node");
      continue;
    }
    const key = JSON.stringify([edge.source, edge.target]);
    if (edges.has(key)) add("duplicate_edge", "Connections must be unique", edge.target);
    edges.add(key);
    parents.get(edge.target)?.add(edge.source);
    if (edge.source === edge.target) add("self_edge", "A node cannot connect to itself", edge.target);
    if (edge.when && nodes.get(edge.source)?.kind !== "condition")
      add("branch_source", "Only a check has yes and no branches", edge.target);
    if (nodes.get(edge.target)?.kind === "webhook")
      add("trigger_input", "The webhook trigger cannot have incoming connections", edge.target);
  }
  const ancestors = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  const visit = (id: string): Set<string> => {
    const saved = ancestors.get(id);
    if (saved) return saved;
    if (visiting.has(id)) {
      add("cycle", "Graphs cannot contain cycles", id);
      return new Set();
    }
    visiting.add(id);
    const found = new Set<string>();
    for (const parent of parents.get(id) ?? []) {
      found.add(parent);
      for (const ancestor of visit(parent)) found.add(ancestor);
    }
    visiting.delete(id);
    ancestors.set(id, found);
    return found;
  };
  for (const node of graph.nodes) {
    const before = visit(node.id);
    if (node.kind !== "webhook" && triggers.length === 1 && !before.has(triggers[0]?.id ?? ""))
      add("disconnected", "Every node must be reachable from the trigger", node.id);
    for (const binding of flowNodeBindings(node)) {
      if (binding.kind === "node" && (binding.node === node.id || !before.has(binding.node)))
        add("binding_ancestor", "An output binding must refer to a connected ancestor", node.id);
    }
  }
  const writes = graph.nodes.filter((node) => node.kind === "table_write");
  for (let i = 0; i < writes.length; i++) {
    const first = writes[i];
    if (!first) continue;
    for (const second of writes.slice(i + 1)) {
      if (
        first.key === second.key &&
        !ancestors.get(first.id)?.has(second.id) &&
        !ancestors.get(second.id)?.has(first.id)
      )
        add("unordered_write", "Writes to the same key require an explicit dependency", second.id);
    }
  }
  const positions = new Set<string>();
  for (const position of graph.layout) {
    if (!nodes.has(position.node) || positions.has(position.node))
      add("layout_node", "Layout must refer to unique existing nodes", position.node);
    positions.add(position.node);
  }
  return issues;
}

export function resolveFlowBinding(
  binding: FlowBinding,
  event: unknown,
  outputs: ReadonlyMap<string, unknown>,
): unknown {
  if (binding.kind === "literal") return binding.value;
  let value = binding.kind === "event" ? event : outputs.get(binding.node);
  if (binding.kind === "node" && !outputs.has(binding.node)) throw new Error("Flow node output is unavailable");
  for (const segment of binding.path) {
    if (
      ["__proto__", "constructor", "prototype"].includes(segment) ||
      value === null ||
      typeof value !== "object" ||
      (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(segment) || Number(segment) >= value.length)) ||
      !Object.hasOwn(value, segment)
    )
      throw new Error("Flow input field is unavailable");
    const descriptor = Object.getOwnPropertyDescriptor(value, segment);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("Flow input field is unavailable");
    value = descriptor.value;
  }
  if (value === undefined) throw new Error("Flow input field is unavailable");
  return value;
}
