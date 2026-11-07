import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { compatibleMigrationTable, sameSchemaSql } from "./migration-schema.ts";
import { MIGRATIONS } from "./migrations.ts";

// Recovery stops at the stable prefix and never replays an existing column's transformation. See HISTORY.md#migration-lineage.
const BASE = 100;
const END = 108;
const columns = [
  { table: "surfaces", name: "page", version: 101 },
  { table: "surfaces", name: "in_apps", version: 102 },
  { table: "messages", name: "model_reported", version: 103 },
  { table: "messages", name: "waiting", version: 104 },
  { table: "runs", name: "queue_order", version: 104 },
  { table: "tasks", name: "goal", version: 105 },
  { table: "tasks", name: "asked", version: 105 },
  { table: "runs", name: "trimmed", version: 108 },
];
const indexes = [
  { name: "runs_queue_order", version: 104 },
  { name: "model_log_run_seq", version: 106 },
  ...[
    "threads_parent",
    "threads_project",
    "threads_asked_from",
    "threads_owner_unread",
    "threads_held",
    "messages_waiting",
    "runs_thread_created",
    "runs_started",
    "jobs_ended",
    "outbox_created",
    "memory_episodes_message",
    "memory_episodes_thread",
    "memory_work_run",
    "memory_work_thread",
    "flow_events_run",
    "flow_events_thread",
    "flow_graph_nodes_run",
    "flow_graph_nodes_thread",
  ].map((name) => ({ name, version: 107 })),
  { name: "runs_trimmed", version: 108 },
];

type Column = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number };
type ObjectRow = { type: string; name: string; tbl_name: string; sql: string | null };
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const tableColumns = (db: DatabaseSync, table: string) =>
  db.prepare(`PRAGMA table_xinfo(${quote(table)})`).all() as Column[];
const objects = (db: DatabaseSync) =>
  db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all() as ObjectRow[];
const columnShape = (column: Column) =>
  JSON.stringify([column.type.toUpperCase(), column.notnull, column.dflt_value, column.pk, column.hidden]);

function diverges(db: DatabaseSync, version: number): boolean {
  const present = new Set(objects(db).map((row) => row.name));
  return (
    columns.some(
      (column) =>
        tableColumns(db, column.table).some((found) => found.name === column.name) !== version >= column.version,
    ) || indexes.some((index) => present.has(index.name) !== version >= index.version)
  );
}

function reject(detail: string): never {
  throw new Error(
    `Cannot reconcile database migrations: ${detail}. Keep the data and use a matching program version; do not reset schema_version.`,
  );
}

function validate(
  db: DatabaseSync,
  reference: DatabaseSync,
  baseline: ObjectRow[],
  baseColumns: Map<string, Column[]>,
): void {
  const actual = objects(db);
  const desired = objects(reference);
  for (const object of actual) {
    if (
      object.type === "trigger" &&
      !desired.some((expected) => expected.type === "trigger" && expected.name === object.name)
    ) {
      reject(`unrecognized trigger ${object.name}`);
    }
  }
  for (const object of baseline) {
    const found = actual.find((row) => row.name === object.name);
    if (!found || found.type !== object.type) reject(`unsupported base object ${object.name}`);
    const compatible =
      object.type === "table"
        ? compatibleMigrationTable(
            found.sql,
            object.sql,
            desired.find((row) => row.name === object.name)?.sql ?? null,
            columns.filter((column) => column.table === object.name).map((column) => column.name),
          )
        : sameSchemaSql(found.sql, object.sql);
    if (!compatible) reject(`incompatible base object ${object.name}`);
  }
  for (const [table, expected] of baseColumns) {
    const found = tableColumns(db, table);
    for (const column of expected) {
      const current = found.find((row) => row.name === column.name);
      if (!current || columnShape(current) !== columnShape(column))
        reject(`incompatible column ${table}.${column.name}`);
    }
  }
  for (const column of columns) {
    const current = tableColumns(db, column.table).find((row) => row.name === column.name);
    const expected = tableColumns(reference, column.table).find((row) => row.name === column.name);
    if (!expected || (current && columnShape(current) !== columnShape(expected))) {
      reject(`incompatible column ${column.table}.${column.name}`);
    }
  }
  for (const index of indexes) {
    const current = actual.find((row) => row.name === index.name);
    const expected = desired.find((row) => row.name === index.name);
    if (!expected || (current && (current.type !== "index" || !sameSchemaSql(current.sql, expected.sql)))) {
      reject(`incompatible index ${index.name}`);
    }
  }
}

/** Reconciles only a recognized additive migration suffix, with a consistent pre-repair copy. */
export function reconcileMigrationLineage(db: DatabaseSync, home: string, version: number): number {
  if (version < BASE || version > END || !diverges(db, version)) return version;
  const reference = new DatabaseSync(":memory:");
  try {
    reference.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    for (const migration of MIGRATIONS.slice(0, BASE)) reference.exec(migration);
    const baseline = objects(reference);
    const baseColumns = new Map(
      baseline.filter((row) => row.type === "table").map((row) => [row.name, tableColumns(reference, row.name)]),
    );
    for (const migration of MIGRATIONS.slice(BASE, END)) reference.exec(migration);
    validate(db, reference, baseline, baseColumns);
    const before = db.prepare("PRAGMA data_version").get()?.data_version;
    const directory = path.join(home, "backups", `migration-${randomUUID()}`);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const backup = path.join(directory, "apx.db");
    db.prepare("VACUUM INTO ?").run(backup);
    fs.chmodSync(backup, 0o600);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (db.prepare("PRAGMA data_version").get()?.data_version !== before) {
        reject("another connection changed the database during backup; stop other cores and retry");
      }
      validate(db, reference, baseline, baseColumns);
      for (const column of columns) {
        if (tableColumns(db, column.table).some((row) => row.name === column.name)) continue;
        if (column.table === "surfaces" && column.name === "in_apps") {
          // The Apps-listing conversion is safe only with its new column, never after an owner's later choices.
          const migration = MIGRATIONS[column.version - 1];
          if (!migration) reject("missing Apps-listing migration");
          db.exec(migration);
          continue;
        }
        const expected = tableColumns(reference, column.table).find((row) => row.name === column.name);
        if (!expected) reject(`missing reference column ${column.table}.${column.name}`);
        db.exec(
          `ALTER TABLE ${quote(column.table)} ADD COLUMN ${quote(column.name)} ${expected.type}` +
            (expected.notnull ? " NOT NULL" : "") +
            (expected.dflt_value === null ? "" : ` DEFAULT ${expected.dflt_value}`),
        );
        if (column.table === "runs" && column.name === "queue_order") db.exec("UPDATE runs SET queue_order = rowid");
      }
      const desired = objects(reference);
      for (const index of indexes) {
        if (objects(db).some((row) => row.name === index.name)) continue;
        const sql = desired.find((row) => row.name === index.name)?.sql;
        if (!sql) reject(`missing reference index ${index.name}`);
        db.exec(sql);
      }
      if (db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") reject("database integrity check failed");
      if (db.prepare("PRAGMA foreign_key_check").all().length) reject("database foreign key check failed");
      db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(END));
      db.exec("COMMIT");
      return END;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    reference.close();
  }
}
