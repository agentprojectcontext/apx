// A check's ways out and comparisons, for the core that runs it and the panel that draws it. Type imports only: the
// panel loads this without zod.
import type { FlowNode } from "./flow-graph.ts";

/** How a case's comparison compares (DECISIONS.md#d-180); `empty` and `not_empty` need nothing to compare with. */
export const FLOW_COMPARE_OPS = [
  "equals",
  "not_equals",
  "contains",
  "starts_with",
  "gt",
  "lt",
  "gte",
  "lte",
  "empty",
  "not_empty",
] as const;
/** What a comparison reads both sides as: text, a number, or yes or no. */
export const FLOW_COMPARE_TYPES = ["text", "number", "boolean"] as const;
/** At most this many comparisons in one case. */
export const FLOW_CASE_RULES = 10;

type Condition = Extract<FlowNode, { kind: "condition" }>;
export type FlowCase = NonNullable<Condition["cases"]>[number];
/** One comparison of a case whose match is `all` or `any` (DECISIONS.md#d-180). */
export type FlowComparison = Extract<FlowCase["match"], { kind: "all" }>["rules"][number];
export type FlowCompareOp = (typeof FLOW_COMPARE_OPS)[number];
export type FlowCompareType = (typeof FLOW_COMPARE_TYPES)[number];

/** The way out of a check when no case holds ("otherwise"); a yes/no check's "no". */
export const FLOW_OTHERWISE = "no";

/** A check's cases in order; a check drawn before cases had one, "yes": its input equals its value. */
export const flowCases = (node: Condition): FlowCase[] =>
  node.cases ?? [{ id: "yes", label: "", match: { kind: "equals", value: node.equals ?? null } }];

/** Every way out of a check: its cases, then otherwise. */
export const flowBranches = (node: Condition): string[] => [...flowCases(node).map((c) => c.id), FLOW_OTHERWISE];

/** Comparisons that read no value to compare with. */
export const flowCompareAlone = (op: FlowCompareOp): boolean => op === "empty" || op === "not_empty";

/** The comparisons each type offers, in the order the editor lists them. */
export const FLOW_OPS_BY_TYPE: Record<FlowCompareType, readonly FlowCompareOp[]> = {
  text: ["equals", "not_equals", "contains", "starts_with", "empty", "not_empty"],
  number: ["equals", "not_equals", "gt", "lt", "gte", "lte", "empty", "not_empty"],
  boolean: ["equals", "not_equals", "empty", "not_empty"],
};

/** One placeholder alone (`$steps.normalize.ok`), filled when the step runs: its value is not known before. */
const PLACEHOLDER_ONLY = /^\$(trigger|steps|vars|apx)(\.[A-Za-z0-9_-]+)*$/;

/**
 * Why a comparison can't run yet, or undefined: no field, nothing to compare with, a comparison its type doesn't
 * offer, or a value typed that is no number (a number) or no yes or no (a yes or no).
 */
export function flowComparisonGap(rule: FlowComparison): "left" | "op" | "right" | undefined {
  if (!rule.left.trim()) return "left";
  if (!FLOW_OPS_BY_TYPE[rule.type].includes(rule.op)) return "op";
  if (flowCompareAlone(rule.op)) return undefined;
  const right = rule.right.trim();
  if (!right) return "right";
  if (PLACEHOLDER_ONLY.test(right) || rule.type === "text") return undefined;
  if (rule.type === "number") return Number.isFinite(Number(right)) ? undefined : "right";
  return right === "true" || right === "false" ? undefined : "right";
}
