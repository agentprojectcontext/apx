// A project's table row as columns (DECISIONS.md#d-176): a row saved as an object has a cell per field; anything else
// saved whole (an older save, a text) is the cell of its `value` column.

/** A row's cells by column. */
export function tableCells(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return value === undefined ? {} : { value };
}
