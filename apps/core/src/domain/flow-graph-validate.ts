import {
  type FlowBinding,
  FlowGraph,
  type FlowGraphIssue,
  type FlowNode,
} from "../../../../packages/protocol/src/flow-graph.ts";
import { flowHttpUrlProblem } from "./flow-http-url.ts";
import { flowTemplateBindings, parseFlowTemplate } from "./flow-template.ts";
import { flowCronProblem } from "./schedule.ts";

/** A run starts at its one trigger: a POST or a schedule. */
export const isFlowTrigger = (node: FlowNode): boolean => node.kind === "webhook" || node.kind === "schedule";

/** Steps that act outside APX: a message sent as the owner, a request to another service. */
export const isFlowOutward = (node: FlowNode): boolean => node.kind === "notify" || node.kind === "http";
const OUTWARD_LIMIT = 8;

/** The templates of a step, where its placeholders are. */
export function flowNodeTemplates(node: FlowNode): string[] {
  if (node.kind === "notify") return [node.text];
  if (node.kind === "http") return [...node.headers.map((h) => h.value), node.body];
  return [];
}

export function flowNodeBindings(node: FlowNode): FlowBinding[] {
  if (node.kind === "condition" || node.kind === "llm" || node.kind === "agent" || node.kind === "routine")
    return [node.input];
  if (node.kind === "table_write") return [node.value];
  try {
    return flowNodeTemplates(node).flatMap(flowTemplateBindings);
  } catch {
    // validateFlowGraph says why.
    return [];
  }
}

/** Headers the request sets itself, or that would change how it reaches the service. */
const OWN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "keep-alive",
  "te",
  "trailer",
  "expect",
  "proxy-authorization",
  "proxy-connection",
]);

function outwardIssues(node: FlowNode, add: (code: string, message: string, node?: string) => void) {
  for (const template of flowNodeTemplates(node)) {
    try {
      parseFlowTemplate(template);
    } catch {
      add("template_invalid", "A placeholder names no step or field", node.id);
    }
  }
  if (node.kind === "notify" && !node.text.trim()) add("message_empty", "The message is empty", node.id);
  if (node.kind !== "http") return;
  const problem = flowHttpUrlProblem(node.url);
  if (problem === "invalid") add("url_invalid", "The address is not a web address", node.id);
  // A private address is checked with the owner's setup (flow-outward.ts), where a test may let its own server in.
  if (problem === "secret") add("url_secret", "Secrets go in a header, not in the address", node.id);
  if (node.method === "GET" && node.body) add("get_body", "A GET request has no body", node.id);
  if (node.body.includes("secret://")) add("body_secret", "Secrets go in a header, not in the body", node.id);
  const names = new Set<string>();
  for (const h of node.headers) {
    const name = h.name.toLowerCase();
    if (OWN_HEADERS.has(name) || name.startsWith("proxy-"))
      add("header_refused", "That header is set by the request itself", node.id);
    if (names.has(name)) add("header_duplicate", "Each header once", node.id);
    names.add(name);
    if (/[\r\n\0]/.test(h.value)) add("header_invalid", "A header value is one line", node.id);
  }
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
  const triggers = graph.nodes.filter(isFlowTrigger);
  if (triggers.length !== 1) add("trigger_count", "A graph needs exactly one trigger");
  for (const node of graph.nodes) {
    if (node.kind !== "schedule") continue;
    const problem = flowCronProblem(node.cron);
    if (problem === "invalid") add("schedule_invalid", "The schedule is not a valid cron expression", node.id);
    if (problem === "too_often") add("schedule_too_often", "A schedule runs at most every five minutes", node.id);
  }
  if (graph.nodes.filter((node) => node.kind === "llm").length > 4)
    add("model_limit", "A graph supports at most four LLM nodes");
  if (graph.nodes.filter(isFlowOutward).length > OUTWARD_LIMIT)
    add("outward_limit", "A graph sends or calls out at most eight times");
  for (const node of graph.nodes) outwardIssues(node, add);
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
    const target = nodes.get(edge.target);
    if (target && isFlowTrigger(target))
      add("trigger_input", "The trigger cannot have incoming connections", edge.target);
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
    if (!isFlowTrigger(node) && triggers.length === 1 && !before.has(triggers[0]?.id ?? ""))
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
