// A save's value per column and what a read gives later steps (DECISIONS.md#d-176): `$steps.<read>.<column>` is the
// first row's cell, empty (null) when the table has no row, so an empty table reads nothing and fails no step.
import type { FlowBinding } from "../../../../packages/protocol/src/flow-graph.ts";
import { tableCells } from "../../../../packages/protocol/src/table-cells.ts";
import type { FlowVarIndex } from "./flow-expr.ts";
import { type FlowApx, parseFlowTemplate, renderFlowTemplate } from "./flow-template.ts";

/**
 * The cells a save fills: a column whose template is one placeholder alone gets that value as it is (absent: null),
 * any other gets the filled text; an empty template leaves the column as the row has it.
 */
export function flowRowCells(
  columns: readonly { name: string; value: string }[],
  reads: { resolve: (b: FlowBinding) => unknown; vars: FlowVarIndex },
  apx?: FlowApx,
): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const c of columns) {
    if (!c.value.trim()) continue;
    const parts = parseFlowTemplate(c.value.trim(), reads.vars);
    const only = parts.length === 1 ? parts[0] : undefined;
    if (only && "binding" in only) {
      let value: unknown;
      try {
        value = reads.resolve(only.binding);
      } catch {
        value = null;
      }
      cells[c.name] = value === undefined ? null : value;
    } else cells[c.name] = renderFlowTemplate(parts, reads.resolve, { missing: "empty", apx }).text;
  }
  return cells;
}

/** The table's columns with the cells of `row` (none: every one null). */
export function flowReadCells(columns: readonly string[], row: unknown): Record<string, unknown> {
  const cells = row === null || row === undefined ? {} : tableCells(row);
  return Object.fromEntries(columns.map((c) => [c, Object.hasOwn(cells, c) ? cells[c] : null]));
}
