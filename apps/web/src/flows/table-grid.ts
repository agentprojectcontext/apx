// A table's rows as the Tables view shows and edits them (DECISIONS.md#d-176): a cell is text as typed, except numbers,
// true/false and JSON lists or objects, which are kept as values; an empty cell is empty.
import type { TableInfo, TableRow } from "@apx/protocol";
import { tableCells } from "../../../../packages/protocol/src/table-cells.ts";

/** A cell as text in the grid and its edit field. */
export function cellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** What a typed cell saves. */
export function cellValue(text: string): unknown {
  const t = text.trim();
  if (!t) return null;
  if (/^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)$/.test(t) || /^[[{]/.test(t)) {
    try {
      const v = JSON.parse(t) as unknown;
      // A number written with leading zeros (a phone, a zip code) stays text.
      if (typeof v === "number" && /^-?0\d/.test(t)) return text;
      return v;
    } catch {
      return text;
    }
  }
  return text;
}

/** Each row's cells by column, in the table's order, plus cells of fields that are no column (kept, not shown). */
export function gridRows(table: Pick<TableInfo, "columns">, rows: readonly TableRow[]) {
  return rows.map((r) => {
    const cells = tableCells(r.value);
    return { key: r.key, updated_at: r.updated_at, cells: table.columns.map((c) => cellText(cells[c])) };
  });
}

/** The values a row's edit saves: only the cells that changed, so a field without a column is kept. */
export function changedCells(
  columns: readonly string[],
  before: readonly string[] | undefined,
  after: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  columns.forEach((c, i) => {
    const next = after[i] ?? "";
    if (!before || next !== (before[i] ?? "")) out[c] = cellValue(next);
  });
  return out;
}
