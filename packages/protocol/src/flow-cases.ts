// A check's ways out, for the core that runs it and the panel that draws it. Type imports only: the panel loads this
// without zod.
import type { FlowNode } from "./flow-graph.ts";

type Condition = Extract<FlowNode, { kind: "condition" }>;
export type FlowCase = NonNullable<Condition["cases"]>[number];

/** The way out of a check when no case holds ("otherwise"); a yes/no check's "no". */
export const FLOW_OTHERWISE = "no";

/** A check's cases in order; a check drawn before cases had one, "yes": its input equals its value. */
export const flowCases = (node: Condition): FlowCase[] =>
  node.cases ?? [{ id: "yes", label: "", match: { kind: "equals", value: node.equals ?? null } }];

/** Every way out of a check: its cases, then otherwise. */
export const flowBranches = (node: Condition): string[] => [...flowCases(node).map((c) => c.id), FLOW_OTHERWISE];
