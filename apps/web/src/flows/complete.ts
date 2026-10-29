// What the editor asks of each step before a drawing can run; a draft keeps steps either way (DECISIONS.md#d-177).
import { flowStepGap } from "@apx/protocol/flow-complete";
import type { FlowNode } from "../../../../packages/protocol/src/flow-graph.ts";
import { ownTable } from "./values.ts";

/**
 * What a step still needs before its drawing can run, the core's rule (`flowStepGap`), and a table chosen for a read or
 * a save: the editor shows no Flow-own table but the one an old definition was drawn with. Undefined when complete.
 */
export function stepGap(n: FlowNode, required: Required = () => []): string | undefined {
  if ((n.kind === "table_read" || n.kind === "table_write") && !n.table && !ownTable(n)) return "table";
  return flowStepGap(n) ?? requiredGap(n, required);
}
/** A table's required columns by its name (DECISIONS.md#d-180); unknown tables have none. */
export type Required = (table: string) => readonly string[];
/** A save by column that leaves a required column of its table without a value, as the core names it. */
export function requiredGap(n: FlowNode, required: Required): "columns" | undefined {
  if (n.kind !== "table_write" || !n.table || !n.columns) return undefined;
  const filled = new Set(n.columns.filter((c) => c.value.trim()).map((c) => c.name));
  return required(n.table).some((c) => !filled.has(c)) ? "columns" : undefined;
}
/** A step that keeps a drawing from running yet; a draft may still keep it (DECISIONS.md#d-177). */
export const blank = (n: FlowNode): boolean => stepGap(n) !== undefined;
/** `blank`, also naming a save that leaves a required column of its table empty. */
export const blankWith =
  (required: Required) =>
  (n: FlowNode): boolean =>
    stepGap(n, required) !== undefined;
