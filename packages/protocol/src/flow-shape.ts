// Which graphs the current Flow executor runs, and the definition each one stands for. Type imports only: the panel
// loads this without zod. The core stays the authority (`flows.set` validates what this builds).
import type { FlowGraph, FlowNode } from "./flow-graph.ts";
import type { FlowDefinition } from "./flow-methods.ts";

/** The part of a definition a graph describes: name, project and on/off live outside the canvas. */
export type FlowShape = Pick<FlowDefinition, "predicates" | "tableKey" | "action"> & { readKeys: string[] };

/** Why a graph cannot run yet; `node` points at the step to fix when there is one. */
export type FlowShapeProblem = {
  code:
    | "trigger" // no webhook, or more than one
    | "branch" // a step leads to two, or two lead to one
    | "loose" // a step is not on the path from the trigger
    | "order" // steps out of trigger → checks → read → save → agent or routine
    | "save" // no step saves what arrived
    | "check" // a check does not compare a field of what arrived with a value
    | "input" // a step reads something other than what arrived
    | "kind"; // a step the executor does not run (model)
  node?: string;
};

export type FlowShapeResult = { ok: true; shape: FlowShape } | { ok: false; problem: FlowShapeProblem };

const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const RANK: Record<FlowNode["kind"], number> = {
  webhook: 0,
  condition: 1,
  table_read: 2,
  table_write: 3,
  agent: 4,
  routine: 4,
  llm: 5,
};
const wholeEvent = (b: { kind: string; path?: string[] }) => b.kind === "event" && b.path?.length === 0;

/** The single path from the trigger, or the first step that keeps the graph from being one. */
function chain(graph: FlowGraph): FlowNode[] | FlowShapeProblem {
  const triggers = graph.nodes.filter((n) => n.kind === "webhook");
  if (triggers.length !== 1 || !triggers[0]) return { code: "trigger" };
  const out = new Map<string, string[]>();
  const into = new Map<string, number>();
  for (const e of graph.edges) {
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    into.set(e.target, (into.get(e.target) ?? 0) + 1);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const path: FlowNode[] = [];
  let at: FlowNode | undefined = triggers[0];
  while (at) {
    if (path.includes(at)) return { code: "branch", node: at.id };
    if ((into.get(at.id) ?? 0) > 1) return { code: "branch", node: at.id };
    path.push(at);
    const next: string[] = out.get(at.id) ?? [];
    if (next.length > 1) return { code: "branch", node: at.id };
    at = next[0] === undefined ? undefined : byId.get(next[0]);
  }
  const loose = graph.nodes.find((n) => !path.includes(n));
  return loose ? { code: "loose", node: loose.id } : path;
}

/** The definition a graph stands for, when the current executor runs it exactly as drawn. */
export function shapeOfGraph(graph: FlowGraph): FlowShapeResult {
  const path = chain(graph);
  if (!Array.isArray(path)) return { ok: false, problem: path };
  const fail = (code: FlowShapeProblem["code"], node: FlowNode): FlowShapeResult => ({
    ok: false,
    problem: { code, node: node.id },
  });
  const shape: FlowShape = { predicates: [], readKeys: [], tableKey: "", action: { kind: "none" } };
  let rank = -1;
  for (const node of path) {
    const r = RANK[node.kind];
    if (node.kind === "llm") return fail("kind", node);
    if (r < rank || (r === rank && r !== 1)) return fail("order", node);
    rank = r;
    switch (node.kind) {
      case "condition": {
        const value = node.equals;
        if (node.input.kind !== "event" || node.input.path.length === 0) return fail("check", node);
        if (typeof value === "string" && value.length > 4096) return fail("check", node);
        shape.predicates.push({ path: node.input.path, equals: value });
        break;
      }
      case "table_read":
        shape.readKeys = node.keys;
        break;
      case "table_write":
        if (!wholeEvent(node.value)) return fail("input", node);
        shape.tableKey = node.key;
        break;
      case "agent":
        if (!wholeEvent(node.input)) return fail("input", node);
        if (!idPattern.test(node.agent)) return fail("input", node);
        shape.action = { kind: "agent", agent: node.agent, prompt: node.prompt };
        break;
      case "routine":
        if (!wholeEvent(node.input)) return fail("input", node);
        if (!idPattern.test(node.routine)) return fail("input", node);
        shape.action = { kind: "routine", routine: node.routine };
        break;
    }
  }
  if (!shape.tableKey) {
    const last = path.at(-1);
    return { ok: false, problem: last ? { code: "save", node: last.id } : { code: "save" } };
  }
  return { ok: true, shape };
}

export const shapeOfDefinition = (d: FlowDefinition): FlowShape => ({
  predicates: d.predicates,
  readKeys: d.readKeys ?? [],
  tableKey: d.tableKey,
  action: d.action,
});

/** Same steps with the same settings; labels and positions do not count. */
export const sameShape = (a: FlowShape, b: FlowShape) =>
  JSON.stringify([a.predicates, a.readKeys, a.tableKey, a.action]) ===
  JSON.stringify([b.predicates, b.readKeys, b.tableKey, b.action]);

/** Ids the panel gives the steps of a definition drawn without a saved graph. */
export const DEFINITION_NODE = {
  trigger: "trigger",
  check: (i: number) => `check-${i + 1}`,
  read: "read",
  save: "save",
  action: "action",
} as const;

/**
 * A definition drawn as a graph, left to right. `label` names each step (the caller's language); `layout` keeps
 * positions a saved graph already has for the same ids.
 */
export function graphOfDefinition(
  d: FlowShape,
  label: (kind: FlowNode["kind"], index: number) => string,
  layout: FlowGraph["layout"] = [],
): FlowGraph {
  const event = { kind: "event" as const, path: [] as string[] };
  const nodes: FlowNode[] = [{ id: DEFINITION_NODE.trigger, kind: "webhook", label: label("webhook", 0) }];
  for (const [i, p] of d.predicates.entries())
    nodes.push({
      id: DEFINITION_NODE.check(i),
      kind: "condition",
      label: label("condition", i),
      input: { kind: "event", path: p.path },
      equals: p.equals,
    });
  if (d.readKeys.length)
    nodes.push({ id: DEFINITION_NODE.read, kind: "table_read", label: label("table_read", 0), keys: d.readKeys });
  nodes.push({
    id: DEFINITION_NODE.save,
    kind: "table_write",
    label: label("table_write", 0),
    key: d.tableKey,
    value: event,
  });
  if (d.action.kind === "agent")
    nodes.push({
      id: DEFINITION_NODE.action,
      kind: "agent",
      label: label("agent", 0),
      agent: d.action.agent,
      prompt: d.action.prompt,
      input: event,
    });
  if (d.action.kind === "routine")
    nodes.push({
      id: DEFINITION_NODE.action,
      kind: "routine",
      label: label("routine", 0),
      routine: d.action.routine,
      input: event,
    });
  const edges = nodes.slice(1).map((n, i) => ({ source: nodes[i]?.id ?? "", target: n.id }));
  const at = new Map(layout.map((p) => [p.node, p]));
  return {
    schemaVersion: 2,
    nodes,
    edges,
    layout: nodes.map((n, i) => at.get(n.id) ?? { node: n.id, x: i * 280, y: 0 }),
  };
}
