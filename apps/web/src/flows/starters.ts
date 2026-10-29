import type { MessageKey } from "../i18n/index.ts";
import { newNode } from "./graph-edit.ts";
import { type FlowGraph, STEP, type StepKind } from "./steps.tsx";

type T = (key: MessageKey) => string;
export type Starter = { title: MessageKey; body: MessageKey; kinds: StepKind[] };

/** Shapes a new flow can start from; each one runs today once its blanks are filled. */
export const STARTERS = {
  agent: { title: "flow.starter.agent", body: "flow.starter.agentBody", kinds: ["webhook", "table_write", "agent"] },
  check: {
    title: "flow.starter.check",
    body: "flow.starter.checkBody",
    kinds: ["webhook", "condition", "table_write"],
  },
  blank: { title: "flow.starter.blank", body: "flow.starter.blankBody", kinds: [] },
} satisfies Record<string, Starter>;

/** The starter as a chain of steps, left to right, with a table key and agent already chosen where it can. */
export function starterGraph(s: Starter, t: T, agent?: string): FlowGraph {
  const nodes = s.kinds.map((kind, i) => {
    const n = newNode(kind, `${kind}-${i + 1}`, t(STEP[kind].label));
    if (n.kind === "table_write") return { ...n, table: "events", key: "latest" };
    if (n.kind === "agent" && agent) return { ...n, agent };
    return n;
  });
  return {
    schemaVersion: 2,
    nodes,
    edges: nodes.slice(1).map((n, i) => ({ source: nodes[i]?.id ?? "", target: n.id })),
    layout: nodes.map((n, i) => ({ node: n.id, x: i * 280, y: 0 })),
  };
}
