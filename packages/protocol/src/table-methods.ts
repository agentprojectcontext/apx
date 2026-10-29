// A project's tables (DECISIONS.md#d-176): named, with columns in order and rows by key, read and filled by Flows, by
// the owner on the Flows screen's Tables and by their agents' tools. A table exists once created, empty or not.
import { z } from "zod";
import { FLOW_TABLE_COLUMNS, FlowColumnName, FlowTableName } from "./flow-graph.ts";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const RowKey = z.string().min(1).max(128);
export const TableInfo = z.object({
  project: z.string(),
  name: z.string(),
  columns: z.array(z.string()),
  /** Columns a save never leaves empty, in the table's order (DECISIONS.md#d-180). */
  required: z.array(z.string()),
  rows: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TableInfo = z.infer<typeof TableInfo>;
export const TableRow = z.object({ key: z.string(), value: z.unknown(), updated_at: z.string() });
export type TableRow = z.infer<typeof TableRow>;
const Table = { project: Id, table: FlowTableName };
const Changed = z.object({ table: TableInfo });

export const tableMethods = {
  /** The tables of a project, or of every project the caller reaches, most recently changed first. */
  "tables.list": {
    params: z.object({ project: Id.optional() }).strict(),
    result: z.object({ tables: z.array(TableInfo) }),
    effect: false,
  },
  /** One table: its columns and a page of its rows, newest first; `cursor` is the previous page's `nextCursor`. */
  "tables.get": {
    params: z
      .object({
        ...Table,
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().min(1).max(200).optional(),
      })
      .strict(),
    result: z.object({ table: TableInfo, rows: z.array(TableRow), nextCursor: z.string().nullable() }),
    effect: false,
  },
  "tables.create": {
    params: z
      .object({ project: Id, name: FlowTableName, columns: z.array(FlowColumnName).max(FLOW_TABLE_COLUMNS).optional() })
      .strict(),
    result: Changed,
    effect: true,
  },
  /** Flows that name the old name stop until the owner picks the table again (`table_missing`). */
  "tables.rename": {
    params: z.object({ ...Table, name: FlowTableName }).strict(),
    result: Changed,
    effect: true,
  },
  /** The table and every row in it. */
  "tables.remove": {
    params: z.object(Table).strict(),
    result: z.object({ removed: z.boolean() }),
    effect: true,
  },
  "tables.column_add": {
    params: z.object({ ...Table, column: FlowColumnName }).strict(),
    result: Changed,
    effect: true,
  },
  /** Renames the column in every row too. */
  "tables.column_rename": {
    params: z.object({ ...Table, column: FlowColumnName, name: FlowColumnName }).strict(),
    result: Changed,
    effect: true,
  },
  /**
   * Marks a column required or not: a save that would leave it empty in a row is refused, and a Flow's save that
   * doesn't fill it is unfinished. Rows saved before keep what they have.
   */
  "tables.column_required": {
    params: z.object({ ...Table, column: FlowColumnName, required: z.boolean() }).strict(),
    result: Changed,
    effect: true,
  },
  /** Removes the column and its value from every row. */
  "tables.column_remove": {
    params: z.object({ ...Table, column: FlowColumnName }).strict(),
    result: Changed,
    effect: true,
  },
  /**
   * Saves a row under `key`: the columns given change, the others keep their values (`replace`: the row is only
   * these). A column the table doesn't have yet is added.
   */
  "tables.write": {
    params: z
      .object({
        ...Table,
        key: RowKey,
        values: z.record(FlowColumnName, z.unknown()),
        replace: z.boolean().optional(),
      })
      .strict(),
    result: z.object({ row: TableRow }),
    effect: true,
  },
  "tables.delete_rows": {
    params: z.object({ ...Table, keys: z.array(RowKey).min(1).max(100) }).strict(),
    result: z.object({ deleted: z.number().int() }),
    effect: true,
  },
} as const;
