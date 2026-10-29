// A check's comparisons as the editor builds and shows them (DECISIONS.md#d-180): a new one, a type change that keeps
// what still makes sense, and a case in one line for the canvas and a run's input.
import {
  FLOW_OPS_BY_TYPE,
  type FlowCase,
  type FlowCompareOp,
  type FlowCompareType,
  type FlowComparison,
  flowCompareAlone,
} from "@apx/protocol/flow-cases";
import type { MessageKey } from "../i18n/index.ts";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
export type RulesMatch = Extract<FlowCase["match"], { kind: "all" | "any" }>;

/** Each comparison as people say it. */
export const OP_LABEL: Record<FlowCompareOp, MessageKey> = {
  equals: "flow.op.equals",
  not_equals: "flow.op.not_equals",
  contains: "flow.op.contains",
  starts_with: "flow.op.starts_with",
  gt: "flow.op.gt",
  lt: "flow.op.lt",
  gte: "flow.op.gte",
  lte: "flow.op.lte",
  empty: "flow.op.empty",
  not_empty: "flow.op.not_empty",
};
export const TYPE_LABEL: Record<FlowCompareType, MessageKey> = {
  text: "flow.f.text",
  number: "flow.f.number",
  boolean: "flow.f.bool",
};

/** A comparison to fill in: text, "is". */
export const newComparison = (left = ""): FlowComparison => ({ left, op: "equals", right: "", type: "text" });

/** The comparison read as another type: its comparison kept when that type offers it, a yes or no starting at yes. */
export function withType(rule: FlowComparison, type: FlowCompareType): FlowComparison {
  if (type === rule.type) return rule;
  const op = FLOW_OPS_BY_TYPE[type].includes(rule.op) ? rule.op : "equals";
  const right = type === "boolean" ? "true" : rule.type === "boolean" ? "" : rule.right;
  return { ...rule, type, op, right };
}

/** The comparison with another comparison chosen; one that reads the field alone clears what it compared with. */
export const withOp = (rule: FlowComparison, op: FlowCompareOp): FlowComparison => ({
  ...rule,
  op,
  right: flowCompareAlone(op) ? "" : rule.type === "boolean" && !rule.right ? "true" : rule.right,
});

/** A label continuing a sentence: its first letter lowercase ("Is empty" → "is empty"). */
const inline = (label: string) => label.charAt(0).toLocaleLowerCase() + label.slice(1);

/** One comparison in words: `$trigger.email contains @`, `$trigger.ok is yes`, `$trigger.note is empty`. */
export function comparisonText(rule: FlowComparison, t: T): string {
  const left = rule.left.trim() || "…";
  const op = inline(t(OP_LABEL[rule.op]));
  if (flowCompareAlone(rule.op)) return `${left} ${op}`;
  const right =
    rule.type === "boolean" && (rule.right === "true" || rule.right === "false")
      ? inline(t(rule.right === "true" ? "flow.f.yes" : "flow.f.no"))
      : rule.right.trim() || "…";
  return `${left} ${op} ${right}`;
}

/** A case of comparisons in one line, joined by "and" or "or". */
export const rulesText = (match: RulesMatch, t: T): string =>
  match.rules
    .map((r) => comparisonText(r, t))
    .join(` ${inline(t(match.kind === "all" ? "flow.f.and" : "flow.f.or"))} `);
