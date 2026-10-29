// A check's comparisons (DECISIONS.md#d-180): each side is a template filled from the run, read as text, a number or
// yes or no. A field that is not there is empty; nothing is evaluated.
import type { FlowCase, FlowComparison } from "../../../../packages/protocol/src/flow-cases.ts";
import type { FlowBinding } from "../../../../packages/protocol/src/flow-graph.ts";
import type { FlowVarIndex } from "./flow-expr.ts";
import { FlowFieldUnavailable } from "./flow-graph-validate.ts";
import { emptyFlowValue, type FlowApx, flowValueText, parseFlowTemplate, renderFlowTemplate } from "./flow-template.ts";

export type FlowOperandReads = {
  resolve: (b: FlowBinding) => unknown;
  vars: FlowVarIndex;
  apx?: FlowApx | undefined;
};

/**
 * One side's value: a placeholder alone gives its value as it is, anything else the filled text. A field the data
 * lacks reads as absent; a step whose answer isn't there yet throws (the check can't be told).
 */
export function flowOperand(template: string, reads: FlowOperandReads): unknown {
  const resolve = (b: FlowBinding) => {
    try {
      return reads.resolve(b);
    } catch (error) {
      if (error instanceof FlowFieldUnavailable) return undefined;
      throw error;
    }
  };
  const parts = parseFlowTemplate(template.trim(), reads.vars);
  const only = parts.length === 1 ? parts[0] : undefined;
  if (only && "binding" in only) return resolve(only.binding);
  return renderFlowTemplate(parts, resolve, { apx: reads.apx }).text;
}

const asNumber = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim()) : Number.NaN;
const asBoolean = (v: unknown): boolean | undefined =>
  v === true || v === "true" ? true : v === false || v === "false" ? false : undefined;

/** Whether `left` compares to `right` as the comparison says; a side that can't be read as its type never holds. */
export function flowCompare(rule: Pick<FlowComparison, "op" | "type">, left: unknown, right: unknown): boolean {
  if (rule.op === "empty") return emptyFlowValue(left);
  if (rule.op === "not_empty") return !emptyFlowValue(left);
  if (rule.op === "not_equals") return !flowCompare({ ...rule, op: "equals" }, left, right);
  if (rule.type === "boolean") {
    const l = asBoolean(left);
    return rule.op === "equals" && l !== undefined && l === asBoolean(right);
  }
  if (rule.type === "number") {
    const [l, r] = [asNumber(left), asNumber(right)];
    if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
    if (rule.op === "equals") return l === r;
    if (rule.op === "gt") return l > r;
    if (rule.op === "lt") return l < r;
    if (rule.op === "gte") return l >= r;
    return rule.op === "lte" && l <= r;
  }
  const [l, r] = [flowValueText(left), flowValueText(right)];
  if (rule.op === "equals") return l === r;
  if (rule.op === "contains") return l.includes(r);
  return rule.op === "starts_with" && l.startsWith(r);
}

/** A case of comparisons: every one holds (`all`), or at least one (`any`). */
export function flowCaseHolds(match: Extract<FlowCase["match"], { kind: "all" | "any" }>, reads: FlowOperandReads) {
  const holds = (r: FlowComparison) =>
    flowCompare(
      r,
      flowOperand(r.left, reads),
      r.op === "empty" || r.op === "not_empty" ? undefined : flowOperand(r.right, reads),
    );
  return match.kind === "all" ? match.rules.every(holds) : match.rules.some(holds);
}
