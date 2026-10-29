// Edits of a Flow drawing that the panel's editor and an agent's tool make alike: a new step's defaults, joining and
// removing steps, and where steps sit. Type imports only: the panel loads this without zod.
import { flowBranches } from "./flow-cases.ts";
import type { FlowBinding, FlowGraph, FlowNode } from "./flow-graph.ts";

type Condition = Extract<FlowNode, { kind: "condition" }>;
export type FlowNodeKind = FlowNode["kind"];

/** A step of this kind with the values a new one starts from. */
export function newNode(kind: FlowNodeKind, id: string, label: string): FlowNode {
  const input: FlowBinding = { kind: "event", path: [] };
  switch (kind) {
    case "webhook":
      return { id, label, kind };
    case "schedule":
      return { id, label, kind, cron: "30 8 * * 1-5" };
    case "condition":
      // The two-case default: "yes" when its comparison holds, else "no".
      return {
        id,
        label,
        kind,
        input,
        cases: [
          {
            id: "yes",
            label: "",
            match: { kind: "all", rules: [{ left: "", op: "equals", right: "", type: "text" }] },
          },
        ],
      };
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

/** Why two steps can't be joined, as a code; null when they can. */
export type FlowConnectionError = "missing" | "self" | "trigger" | "duplicate" | "limit" | "cycle";

export function connectionError(graph: FlowGraph, source: string, target: string): FlowConnectionError | null {
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

export function disconnectNodes(graph: FlowGraph, source: string, target: string): FlowGraph {
  return { ...graph, edges: graph.edges.filter((e) => !(e.source === source && e.target === target)) };
}

/** How far apart steps are drawn: a column per step along the path, a row per branch. */
export const FLOW_COLUMN = 280;
export const FLOW_ROW = 160;

/**
 * Every step placed left to right: a column by its longest path from a start (a trigger, or a step nothing leads
 * into), and in each column the steps in the order of the ones leading into them, centred on the first row.
 */
export function layoutFlow(graph: Pick<FlowGraph, "nodes" | "edges">): FlowGraph["layout"] {
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const into = new Map<string, string[]>();
  for (const e of graph.edges)
    if (order.has(e.source) && order.has(e.target)) into.set(e.target, [...(into.get(e.target) ?? []), e.source]);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    // A cycle (a drawing that can't run anyway) is cut where it closes.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(-1, ...(into.get(id) ?? []).map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  const columns: string[][] = [];
  for (const n of graph.nodes) {
    const d = depthOf(n.id);
    columns[d] = [...(columns[d] ?? []), n.id];
  }
  const row = new Map<string, number>();
  const layout: FlowGraph["layout"] = [];
  columns.forEach((ids = [], d) => {
    const weight = (id: string) => {
      const rows = (into.get(id) ?? []).map((s) => row.get(s)).filter((r): r is number => r !== undefined);
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : (order.get(id) ?? 0);
    };
    const sorted = [...ids].sort((a, b) => weight(a) - weight(b) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
    sorted.forEach((id, i) => {
      row.set(id, i);
      layout.push({ node: id, x: d * FLOW_COLUMN, y: Math.round((i - (sorted.length - 1) / 2) * FLOW_ROW) });
    });
  });
  return layout;
}

/**
 * The drawing with a place for every step: one with no places at all is laid out whole; otherwise steps keep theirs
 * and each one without a place goes right of the step leading into it, on the nearest free row.
 */
export function placeSteps(graph: FlowGraph): FlowGraph {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const kept = graph.layout.filter((p) => ids.has(p.node));
  if (!kept.length) return { ...graph, layout: layoutFlow(graph) };
  const at = new Map(kept.map((p) => [p.node, { x: p.x, y: p.y }]));
  const taken = (x: number, y: number) =>
    [...at.values()].some((p) => Math.abs(p.x - x) < FLOW_COLUMN * 0.7 && Math.abs(p.y - y) < FLOW_ROW * 0.7);
  for (const n of graph.nodes) {
    if (at.has(n.id)) continue;
    const parent = graph.edges.map((e) => (e.target === n.id ? at.get(e.source) : undefined)).find(Boolean);
    const right = Math.max(...[...at.values()].map((p) => p.x));
    const x = Math.max(-100000, Math.min(100000, parent ? parent.x + FLOW_COLUMN : right + FLOW_COLUMN));
    const from = parent ? parent.y : 0;
    // The nearest free row, below or above, in half rows: it lines up with branches centred on the path.
    let y = from;
    for (let k = 1; taken(x, y) && k < 400; k++) y = from + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (FLOW_ROW / 2);
    at.set(n.id, { x, y });
  }
  return { ...graph, layout: graph.nodes.map((n) => ({ node: n.id, ...(at.get(n.id) as { x: number; y: number }) })) };
}
