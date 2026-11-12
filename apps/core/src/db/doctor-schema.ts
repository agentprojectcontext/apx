import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sameSchemaSql } from "./migration-schema.ts";
import { MIGRATIONS } from "./migrations.ts";

type ObjectRow = { type: string; name: string; tbl_name: string; sql: string | null };
const objects = (db: DatabaseSync) =>
  db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name")
    .all() as ObjectRow[];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

function columns(db: DatabaseSync, name: string) {
  return db
    .prepare(`PRAGMA table_xinfo(${quote(name)})`)
    .all()
    .map((row) => ({
      name: String(row.name),
      type: String(row.type),
      not_null: Boolean(row.notnull),
      primary_key: Number(row.pk),
      hidden: Number(row.hidden),
      default_value: row.dflt_value,
    }));
}

function foreignKeys(db: DatabaseSync, name: string) {
  return db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all();
}

function compare(db: DatabaseSync, reference: DatabaseSync) {
  const actual = objects(db);
  const expected = objects(reference);
  const differences: { object: string; type: string; kind: string; columns?: string[] }[] = [];
  for (const object of expected) {
    const found = actual.find((row) => row.name === object.name && row.type === object.type);
    if (!found) {
      differences.push({ object: object.name, type: object.type, kind: "missing" });
      continue;
    }
    if (!sameSchemaSql(found.sql, object.sql) || found.tbl_name !== object.tbl_name) {
      differences.push({ object: object.name, type: object.type, kind: "declaration differs" });
    }
    if (object.type !== "table") continue;
    const left = columns(db, found.name);
    const right = columns(reference, object.name);
    const added = left.filter((col) => !right.some((expected) => expected.name === col.name));
    const missing = right.filter((col) => !left.some((actual) => actual.name === col.name));
    const changed = left.filter((col) =>
      right.some((expected) => expected.name === col.name && JSON.stringify(expected) !== JSON.stringify(col)),
    );
    for (const [kind, list] of [
      ["extra columns", added],
      ["missing columns", missing],
      ["changed columns", changed],
    ] as const) {
      if (list.length)
        differences.push({ object: object.name, type: object.type, kind, columns: list.map((col) => col.name) });
    }
    if (JSON.stringify(foreignKeys(db, found.name)) !== JSON.stringify(foreignKeys(reference, object.name))) {
      differences.push({ object: object.name, type: object.type, kind: "foreign keys differ" });
    }
  }
  for (const object of actual) {
    if (!expected.some((row) => row.name === object.name && row.type === object.type)) {
      differences.push({ object: object.name, type: object.type, kind: "extra" });
    }
  }
  return differences;
}

function reference(version: number, hotfix: boolean) {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    for (const sql of MIGRATIONS.slice(0, hotfix ? 108 : version)) db.exec(sql);
    if (hotfix) db.exec("ALTER TABLE jobs ADD COLUMN start_error TEXT");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Schema-only evidence: never reads owner rows, default values, SQL bodies or the core log into the report. */
export function diagnoseOfflineSchema(home: string) {
  const file = path.join(home, "apx.db");
  if (!fs.existsSync(file))
    throw new Error("No existing database to diagnose. Check APX_HOME; no database was created.");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA trusted_schema = OFF; BEGIN");
    const version = Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value);
    if (!Number.isInteger(version) || version < 0 || version > MIGRATIONS.length) {
      throw new Error("Unsupported schema version; use a matching APX version to diagnose this database.");
    }
    const hotfix = version === 109 && columns(db, "jobs").some((col) => col.name === "start_error");
    const current = reference(version, hotfix);
    const final = reference(MIGRATIONS.length, false);
    try {
      return {
        schema_version: version,
        reference: hotfix ? "Published 2.13.4 hotfix schema 109" : `Installed migrations at schema ${version}`,
        target_version: MIGRATIONS.length,
        objects: objects(db).map(({ type, name, tbl_name }) => ({ type, name, table: tbl_name })),
        differences: compare(db, current),
        target_differences: compare(db, final),
        note: "Read-only structural report. No owner rows, SQL bodies, default values or logs included. Differences do not authorize repair. Review object names before sharing.",
      };
    } finally {
      current.close();
      final.close();
    }
  } finally {
    db.close();
  }
}
