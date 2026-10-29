// A project's tables (DECISIONS.md#d-173, #d-176): created by name, empty or not, with their columns in order, and rows
// by key. Flows save and read them, the owner fills them on the Flows screen and their agents through apx_settings.
import { FLOW_TABLE_COLUMNS, FlowColumnName } from "../../../../packages/protocol/src/flow-graph.ts";
import { tableCells } from "../../../../packages/protocol/src/table-cells.ts";
import type { Db } from "../db/db.ts";
import { redactedJson } from "../log.ts";
import { FlowCapacityError } from "./flow-events.ts";
import { now, qb, sql } from "./sql.ts";

const MAX_ROWS = 1000;
const MAX_TABLES = 100;
const MAX_ALL = 10000;
const MAX_VALUE = 32768;

export type FlowTableRow = { key: string; value: unknown; updated_at: string };
export type FlowTableInfo = {
  project: string;
  name: string;
  columns: string[];
  /** Columns a save never leaves empty (DECISIONS.md#d-180). */
  required: string[];
  rows: number;
  created_at: string;
  updated_at: string;
};
/** The table is not in the project (never made, renamed or removed). */
export class FlowTableMissing extends Error {}
/** The name is taken, or the column is already there or not there. */
export class FlowTableConflict extends Error {}
/** A save would leave these required columns empty in the row (DECISIONS.md#d-180). */
export class FlowTableRequired extends Error {
  readonly columns: string[];
  constructor(columns: string[]) {
    super(`Fill the required ${columns.length === 1 ? "column" : "columns"} ${columns.join(", ")}`);
    this.columns = columns;
  }
}

/** Nothing in it: absent, null, blank text, an empty list or object. */
const emptyCell = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && !value.trim()) ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);

/** The required columns a row would leave empty. */
export const emptyRequired = (required: readonly string[], row: unknown): string[] => {
  const cells = tableCells(row);
  return required.filter((c) => emptyCell(Object.hasOwn(cells, c) ? cells[c] : undefined));
};

const parsed = (r: { key: string; value: string; updated_at: string }): FlowTableRow => ({
  key: r.key,
  value: JSON.parse(r.value) as unknown,
  updated_at: r.updated_at,
});

/** A key as it will be stored: one line of at most 128 characters, never a credential. */
export function flowRowKey(key: string): string {
  const k = key.trim();
  if (!k || k.length > 128 || /[\r\n\0]/.test(k) || redactedJson(k) !== JSON.stringify(k))
    throw new Error("Invalid flow row key");
  return k;
}

/** The columns a value brings: its fields that can be a column's name, or `value` for one that is not an object. */
const columnsOf = (value: unknown) =>
  Object.keys(tableCells(value)).filter((name) => FlowColumnName.safeParse(name).success);

export function flowTablesRepo(db: Db) {
  const { one, all, run, tx } = sql(db);
  const count = (project?: string, name?: string) => {
    let q = qb.selectFrom("flow_tables").select((e) => e.fn.countAll<number>().as("n"));
    if (project !== undefined) q = q.where("project_id", "=", project);
    if (name !== undefined) q = q.where("name", "=", name);
    return Number(one(q)?.n ?? 0);
  };
  const def = (project: string, name: string) =>
    one(qb.selectFrom("flow_table_defs").selectAll().where("project_id", "=", project).where("name", "=", name));
  const info = (d: NonNullable<ReturnType<typeof def>>): FlowTableInfo => {
    const columns = JSON.parse(d.columns) as string[];
    const required = new Set(JSON.parse(d.required) as string[]);
    return {
      project: d.project_id,
      name: d.name,
      columns,
      required: columns.filter((c) => required.has(c)),
      rows: count(d.project_id, d.name),
      created_at: d.created_at,
      updated_at: d.updated_at,
    };
  };
  const get = (project: string, name: string) => {
    const d = def(project, name);
    return d ? info(d) : undefined;
  };
  const must = (project: string, name: string) => {
    const t = get(project, name);
    if (!t) throw new FlowTableMissing("Table");
    return t;
  };
  /** The columns in order; `required` changes which must be filled (kept to columns the table has). */
  const setColumns = (project: string, name: string, columns: string[], at = now(), required?: string[]) =>
    run(
      qb
        .updateTable("flow_table_defs")
        .set({
          columns: JSON.stringify(columns),
          ...(required ? { required: JSON.stringify(required.filter((c) => columns.includes(c))) } : {}),
          updated_at: at,
        })
        .where("project_id", "=", project)
        .where("name", "=", name),
    );
  const rowsOf = (project: string, name: string) =>
    all(
      qb
        .selectFrom("flow_tables")
        .select(["key", "value", "updated_at"])
        .where("project_id", "=", project)
        .where("name", "=", name),
    ).map(parsed);
  const putRow = (project: string, name: string, key: string, stored: string, at: string) =>
    run(
      qb
        .insertInto("flow_tables")
        .values({ project_id: project, name, key, value: stored, updated_at: at })
        .onConflict((oc) => oc.columns(["project_id", "name", "key"]).doUpdateSet({ value: stored, updated_at: at })),
    );
  /** Rewrites the rows that have `column` (renamed or removed), keeping when each row last changed. */
  const rewrite = (
    project: string,
    name: string,
    column: string,
    change: (cells: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    for (const row of rowsOf(project, name)) {
      const cells = tableCells(row.value);
      if (column in cells) putRow(project, name, row.key, JSON.stringify(change({ ...cells })), row.updated_at);
    }
  };
  /** The tables of a project, or of every project, the most recently changed first. */
  const list = (project?: string): FlowTableInfo[] => {
    let q = qb.selectFrom("flow_table_defs").selectAll();
    if (project !== undefined) q = q.where("project_id", "=", project);
    return all(
      q
        .orderBy("updated_at", "desc")
        .orderBy("name")
        .limit(project === undefined ? 1000 : MAX_TABLES),
    ).map(info);
  };
  return {
    list,
    get,
    create(project: string, name: string, columns: readonly string[] = []): FlowTableInfo {
      return tx(() => {
        if (def(project, name)) throw new FlowTableConflict("A table with that name already exists");
        if (list(project).length >= MAX_TABLES) throw new FlowCapacityError("The project has too many tables");
        const at = now();
        run(
          qb.insertInto("flow_table_defs").values({
            project_id: project,
            name,
            columns: JSON.stringify([...new Set(columns)].slice(0, FLOW_TABLE_COLUMNS)),
            created_at: at,
            updated_at: at,
          }),
        );
        return must(project, name);
      });
    },
    rename(project: string, name: string, to: string): FlowTableInfo {
      return tx(() => {
        must(project, name);
        if (to === name) return must(project, name);
        if (def(project, to)) throw new FlowTableConflict("A table with that name already exists");
        run(
          qb
            .updateTable("flow_table_defs")
            .set({ name: to, updated_at: now() })
            .where("project_id", "=", project)
            .where("name", "=", name),
        );
        run(qb.updateTable("flow_tables").set({ name: to }).where("project_id", "=", project).where("name", "=", name));
        return must(project, to);
      });
    },
    remove(project: string, name: string): boolean {
      return tx(() => {
        if (!def(project, name)) return false;
        run(qb.deleteFrom("flow_tables").where("project_id", "=", project).where("name", "=", name));
        run(qb.deleteFrom("flow_table_defs").where("project_id", "=", project).where("name", "=", name));
        return true;
      });
    },
    addColumn(project: string, name: string, column: string): FlowTableInfo {
      return tx(() => {
        const t = must(project, name);
        if (t.columns.includes(column)) throw new FlowTableConflict("The table already has that column");
        if (t.columns.length >= FLOW_TABLE_COLUMNS) throw new FlowCapacityError("The table has too many columns");
        setColumns(project, name, [...t.columns, column]);
        return must(project, name);
      });
    },
    renameColumn(project: string, name: string, column: string, to: string): FlowTableInfo {
      return tx(() => {
        const t = must(project, name);
        if (!t.columns.includes(column)) throw new FlowTableMissing("Column");
        if (to === column) return t;
        if (t.columns.includes(to)) throw new FlowTableConflict("The table already has that column");
        // Same place in the row, new name.
        rewrite(project, name, column, (cells) =>
          Object.fromEntries(Object.entries(cells).map(([k, v]) => [k === column ? to : k, v])),
        );
        const renamed = (c: string) => (c === column ? to : c);
        setColumns(project, name, t.columns.map(renamed), now(), t.required.map(renamed));
        return must(project, name);
      });
    },
    removeColumn(project: string, name: string, column: string): FlowTableInfo {
      return tx(() => {
        const t = must(project, name);
        if (!t.columns.includes(column)) throw new FlowTableMissing("Column");
        rewrite(project, name, column, ({ [column]: _gone, ...rest }) => rest);
        const left = t.columns.filter((c) => c !== column);
        setColumns(project, name, left, now(), t.required);
        return must(project, name);
      });
    },
    /** Marks a column required or not; rows saved before keep what they have. */
    requireColumn(project: string, name: string, column: string, required: boolean): FlowTableInfo {
      return tx(() => {
        const t = must(project, name);
        if (!t.columns.includes(column)) throw new FlowTableMissing("Column");
        const next = required ? [...t.required, column] : t.required.filter((c) => c !== column);
        setColumns(project, name, t.columns, now(), next);
        return must(project, name);
      });
    },
    /**
     * Saves `value` under `key` in a table of the project. `merge`: an object's fields change those cells and keep the
     * row's others; else the row becomes `value`. Fields the table has no column for become columns.
     */
    write(project: string, name: string, key: string, value: unknown, o: { merge?: boolean } = {}): FlowTableRow {
      const k = flowRowKey(key);
      if (JSON.stringify(value) === undefined) throw new Error("Flow value is not data");
      return tx(() => {
        const t = must(project, name);
        const was = one(
          qb
            .selectFrom("flow_tables")
            .select(["key", "value", "updated_at"])
            .where("project_id", "=", project)
            .where("name", "=", name)
            .where("key", "=", k),
        );
        if (!was) {
          if (t.rows >= MAX_ROWS) throw new FlowCapacityError("Flow table is full");
          if (count() >= MAX_ALL) throw new FlowCapacityError("Flow tables are full");
        }
        const next = o.merge && was ? { ...tableCells(parsed(was).value), ...tableCells(value) } : value;
        const empty = emptyRequired(t.required, next);
        if (empty.length) throw new FlowTableRequired(empty);
        const stored = redactedJson(next);
        if (Buffer.byteLength(stored) > MAX_VALUE) throw new Error("Flow value exceeds 32 KiB");
        const at = now();
        putRow(project, name, k, stored, at);
        const added = columnsOf(next).filter((c) => !t.columns.includes(c));
        setColumns(project, name, [...t.columns, ...added].slice(0, FLOW_TABLE_COLUMNS), at);
        return { key: k, value: JSON.parse(stored) as unknown, updated_at: at };
      });
    },
    /** Removes the rows under these keys; how many there were. */
    deleteRows(project: string, name: string, keys: readonly string[]): number {
      return tx(() => {
        must(project, name);
        const gone = count(project, name);
        run(
          qb
            .deleteFrom("flow_tables")
            .where("project_id", "=", project)
            .where("name", "=", name)
            .where("key", "in", [...keys]),
        );
        const left = count(project, name);
        if (gone !== left) setColumns(project, name, must(project, name).columns);
        return gone - left;
      });
    },
    /** The rows saved under these keys, by key; keys with no row are left out. */
    read(project: string, name: string, keys: readonly string[]): Record<string, unknown> {
      if (!keys.length) return {};
      const rows = all(
        qb
          .selectFrom("flow_tables")
          .select(["key", "value", "updated_at"])
          .where("project_id", "=", project)
          .where("name", "=", name)
          .where("key", "in", [...keys]),
      ).map(parsed);
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      return Object.fromEntries(keys.flatMap((k) => (byKey.has(k) ? [[k, byKey.get(k)]] : [])));
    },
    /** The `limit` rows saved last, newest first; `cursor` is the last row's `updated_at|key` of a previous page. */
    latest(project: string, name: string, limit: number, cursor?: string): FlowTableRow[] {
      let q = qb
        .selectFrom("flow_tables")
        .select(["key", "value", "updated_at"])
        .where("project_id", "=", project)
        .where("name", "=", name);
      if (cursor) {
        const at = cursor.indexOf("|");
        const [time, key] = [cursor.slice(0, at), cursor.slice(at + 1)];
        q = q.where((e) => e.or([e("updated_at", "<", time), e.and([e("updated_at", "=", time), e("key", "<", key)])]));
      }
      return all(q.orderBy("updated_at", "desc").orderBy("key", "desc").limit(limit)).map(parsed);
    },
  };
}
