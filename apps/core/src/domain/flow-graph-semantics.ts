import type { FlowBinding, FlowGraph, FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import { resolveFlowBinding, validateFlowGraph } from "./flow-graph-validate.ts";

export type FlowNodeState =
  | "pending"
  | "running"
  | "waiting_run"
  | "succeeded"
  | "skipped"
  | "blocked"
  | "failed"
  | "uncertain"
  | "cancelled";
export type FlowNodeSnapshot = { state: FlowNodeState; output?: unknown };
export type FlowStepDecision = {
  node: string;
  decision: "ready" | "blocked" | "skipped" | "cancelled";
  reason: "parents_succeeded" | "parent_failed" | "parent_skipped" | "cancelled" | "deadline";
};
const active = new Set<FlowNodeState>(["pending", "running", "waiting_run"]);
const unsuccessful = new Set<FlowNodeState>(["blocked", "failed", "uncertain", "cancelled"]);
const states = new Set<FlowNodeState>([...active, ...unsuccessful, "succeeded", "skipped"]);
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function flowGraphOrder(graph: FlowGraph): FlowNode[] {
  if (validateFlowGraph(graph).length) throw new Error("Invalid flow graph");
  const remaining = new Map(graph.nodes.map((node) => [node.id, node]));
  const completed = new Set<string>();
  const ordered: FlowNode[] = [];
  while (remaining.size) {
    const next = [...remaining.values()]
      .filter((node) => graph.edges.every((edge) => edge.target !== node.id || completed.has(edge.source)))
      .sort((a, b) => ordinal(a.id, b.id))[0];
    if (!next) throw new Error("Invalid flow graph");
    ordered.push(next);
    completed.add(next.id);
    remaining.delete(next.id);
  }
  return ordered;
}

export function planFlowGraphStep(
  graph: FlowGraph,
  snapshots: ReadonlyMap<string, FlowNodeSnapshot>,
  control: { cancelled?: boolean; deadlineExceeded?: boolean } = {},
): FlowStepDecision[] {
  const nodes = flowGraphOrder(graph);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (snapshots.size !== nodes.length) throw new Error("Incomplete flow snapshot");
  for (const node of nodes) {
    const snapshot = snapshots.get(node.id);
    if (!snapshot || !states.has(snapshot.state)) throw new Error("Invalid flow snapshot");
  }
  if (!control.cancelled && !control.deadlineExceeded) {
    for (const node of nodes) {
      const snapshot = requiredSnapshot(snapshots, node.id);
      if (node.kind === "condition" && snapshot.state === "succeeded") conditionMatched(snapshot.output);
    }
  }
  const decisions: FlowStepDecision[] = [];
  for (const node of nodes) {
    if (snapshots.get(node.id)?.state !== "pending") continue;
    const add = (decision: FlowStepDecision["decision"], reason: FlowStepDecision["reason"]) =>
      decisions.push({ node: node.id, decision, reason });
    if (control.cancelled || control.deadlineExceeded) {
      add("cancelled", control.cancelled ? "cancelled" : "deadline");
      continue;
    }
    const incoming = graph.edges.filter((edge) => edge.target === node.id);
    const parents = incoming.map((edge) => edge.source);
    if (parents.some((id) => active.has(requiredSnapshot(snapshots, id).state))) continue;
    if (parents.some((id) => unsuccessful.has(requiredSnapshot(snapshots, id).state))) {
      add("blocked", "parent_failed");
      continue;
    }
    // A check's "yes" branch goes on when it matched, its "no" branch when it did not.
    const skipped = incoming.some(({ source, when }) => {
      const parent = requiredSnapshot(snapshots, source);
      return (
        parent.state === "skipped" ||
        (byId.get(source)?.kind === "condition" && conditionMatched(parent.output) !== (when !== "no"))
      );
    });
    add(skipped ? "skipped" : "ready", skipped ? "parent_skipped" : "parents_succeeded");
  }
  return decisions;
}

function requiredSnapshot(snapshots: ReadonlyMap<string, FlowNodeSnapshot>, id: string): FlowNodeSnapshot {
  const snapshot = snapshots.get(id);
  if (!snapshot) throw new Error("Incomplete flow snapshot");
  return snapshot;
}

function conditionMatched(output: unknown): boolean {
  const value = boundedFlowValue(output);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid condition output");
  const matched = Object.getOwnPropertyDescriptor(value, "matched");
  if (!matched || !("value" in matched) || typeof matched.value !== "boolean" || Object.keys(value).length !== 1)
    throw new Error("Invalid condition output");
  return matched.value;
}

export function resolveFlowInput(
  binding: FlowBinding,
  event: unknown,
  snapshots: ReadonlyMap<string, FlowNodeSnapshot>,
): unknown {
  const outputs = new Map<string, unknown>();
  if (binding.kind === "node") {
    const snapshot = snapshots.get(binding.node);
    if (snapshot?.state !== "succeeded") throw new Error("Flow node output is unavailable");
    outputs.set(binding.node, boundedFlowValue(snapshot.output));
  }
  return boundedFlowValue(
    resolveFlowBinding(binding, binding.kind === "event" ? boundedFlowValue(event) : null, outputs),
  );
}

export function evaluateFlowCondition(
  node: Extract<FlowNode, { kind: "condition" }>,
  input: unknown,
): { matched: boolean } {
  return { matched: boundedFlowValue(input) === node.equals };
}

export function summarizeFlowGraph(
  snapshots: ReadonlyMap<string, FlowNodeSnapshot>,
): "pending" | "running" | "succeeded" | "failed" | "uncertain" | "cancelled" {
  if (!snapshots.size) throw new Error("Incomplete flow snapshot");
  const values = [...snapshots.values()].map((snapshot) => snapshot.state);
  if (values.some((state) => !states.has(state))) throw new Error("Invalid flow snapshot");
  if (values.some((state) => state === "running" || state === "waiting_run")) return "running";
  if (values.includes("pending")) return "pending";
  if (values.includes("uncertain")) return "uncertain";
  if (values.some((state) => state === "failed" || state === "blocked")) return "failed";
  if (values.includes("cancelled")) return "cancelled";
  return "succeeded";
}

// Parsed JSON is the boundary: descriptor copies avoid accessor/toJSON hooks, not arbitrary Proxy traps.
export function boundedFlowValue(value: unknown): unknown {
  const ancestors = new Set<object>();
  let entries = 0;
  let rawBytes = 0;
  const countBytes = (text: string) => {
    rawBytes += Buffer.byteLength(text);
    if (rawBytes > 32768) throw new Error("Flow value exceeds 32 KiB");
  };
  const visit = (current: unknown, depth: number): unknown => {
    if (++entries > 32768 || depth > 32) throw new Error("Flow value exceeds limits");
    if (typeof current === "string") {
      countBytes(current);
      return current;
    }
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number" && Number.isFinite(current)) return current;
    if (typeof current !== "object" || current === null) throw new Error("Invalid flow JSON value");
    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array))
      throw new Error("Invalid flow JSON value");
    if (ancestors.has(current)) throw new Error("Invalid flow JSON value");
    ancestors.add(current);
    const copy: object = array ? [] : Object.create(null);
    Object.setPrototypeOf(copy, null);
    const keys = Reflect.ownKeys(current).filter((key) => !(array && key === "length"));
    if (array && keys.length !== current.length) throw new Error("Invalid flow JSON value");
    for (const key of keys) {
      if (typeof key !== "string") throw new Error("Invalid flow JSON value");
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length))
        throw new Error("Invalid flow JSON value");
      if (!array) countBytes(key);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("Invalid flow JSON value");
      Object.defineProperty(copy, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    ancestors.delete(current);
    return copy;
  };
  const encoded = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(encoded) > 32768) throw new Error("Flow value exceeds 32 KiB");
  return JSON.parse(encoded);
}
