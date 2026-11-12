import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sameSchemaSql } from "./migration-schema.ts";
import { MIGRATIONS } from "./migrations.ts";

const HOTFIX = 109;
const INTEGRATED = 115;
type SchemaObject = { type: string; name: string; tbl_name: string; sql: string | null };
const objects = (db: DatabaseSync) =>
  db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
    .all() as SchemaObject[];

function reject(detail: string): never {
  throw new Error(
    `Cannot reconcile hotfix database: ${detail}. Keep the data and use a matching program version; do not reset schema_version.`,
  );
}

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// An index someone added by hand only speeds up reads: dropping it loses no data, and the backup keeps its definition.
// A UNIQUE one constrains data, and a name APX's migrations use means a mixed lineage: both stay refused.
function foreignIndex(object: SchemaObject, tables: Set<string>): boolean {
  if (object.type !== "index" || !object.sql || !tables.has(object.tbl_name)) return false;
  if (/^\s*create\s+unique\b/i.test(object.sql)) return false;
  const name = new RegExp(`(^|[^\\w$])${escaped(object.name)}($|[^\\w$])`, "i");
  return !MIGRATIONS.some((sql) => name.test(sql));
}

// See HISTORY.md#hotfix-migration-lineage. Preserve the observed nullable extension without interpreting its data.
function sameHotfixTable(found: SchemaObject, expected: SchemaObject): boolean {
  if (sameSchemaSql(found.sql, expected.sql)) return true;
  return (
    expected.type === "table" &&
    expected.name === "flow_schedules" &&
    sameSchemaSql(found.sql, expected.sql?.replace(/\)\s*$/, ", activated_at TEXT)") ?? null)
  );
}

/** Returns the extra indexes to drop; table differences are limited to the observed schedule extension. */
function validate(db: DatabaseSync, reference: DatabaseSync): string[] {
  if (db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value !== String(HOTFIX)) {
    reject("database version changed during reconciliation");
  }
  const expected = objects(reference);
  const known = new Set(expected.map((object) => object.name));
  const tables = new Set(expected.filter((object) => object.type === "table").map((object) => object.name));
  const extra = objects(db).filter((object) => !known.has(object.name));
  if (!extra.every((object) => foreignIndex(object, tables))) reject("unrecognized schema objects");
  const actual = objects(db).filter((object) => known.has(object.name));
  if (actual.length !== expected.length) reject("unrecognized schema objects");
  for (const object of expected) {
    const found = actual.find((row) => row.name === object.name);
    if (!found || found.type !== object.type || found.tbl_name !== object.tbl_name || !sameHotfixTable(found, object)) {
      reject(`incompatible schema object ${object.name}`);
    }
  }
  return extra.map((object) => object.name);
}

// See HISTORY.md#hotfix-migration-lineage.
/** Joins the published hotfix's exact schema to staging without replaying existing transformations. */
export function reconcileHotfixLineage(
  db: DatabaseSync,
  home: string,
  version: number,
  reportBackup?: (file: string) => void,
): number {
  if (version < HOTFIX || version >= INTEGRATED) return version;
  const hasReason = db
    .prepare("PRAGMA table_xinfo(jobs)")
    .all()
    .some((row) => row.name === "start_error");
  if (!hasReason) return version;
  if (version !== HOTFIX) reject("unrecognized mixed migration lineage");
  const reference = new DatabaseSync(":memory:");
  try {
    reference.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    for (const sql of MIGRATIONS.slice(0, HOTFIX - 1)) reference.exec(sql);
    reference.exec("ALTER TABLE jobs ADD COLUMN start_error TEXT");
    validate(db, reference);
    const before = db.prepare("PRAGMA data_version").get()?.data_version;
    const directory = path.join(home, "backups", `migration-hotfix-${randomUUID()}`);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const backup = path.join(directory, "apx.db");
    db.prepare("VACUUM INTO ?").run(backup);
    fs.chmodSync(backup, 0o600);
    reportBackup?.(backup);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (db.prepare("PRAGMA data_version").get()?.data_version !== before) {
        reject("another connection changed the database during backup; stop other cores and retry");
      }
      for (const name of validate(db, reference)) db.exec(`DROP INDEX ${quoted(name)}`);
      for (const sql of MIGRATIONS.slice(HOTFIX - 1, INTEGRATED - 1)) db.exec(sql);
      if (db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") reject("database integrity check failed");
      if (db.prepare("PRAGMA foreign_key_check").all().length) reject("database foreign key check failed");
      db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(INTEGRATED));
      db.exec("COMMIT");
      return INTEGRATED;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    reference.close();
  }
}
