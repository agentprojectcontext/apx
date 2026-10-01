// How repositories reach SQLite. Queries are built with Kysely, typed against the schema generated from the
// migrations (db/schema.ts), then compiled and run synchronously on node:sqlite: the store stays synchronous, so a
// transaction is plain code with no awaits in between. See DECISIONS.md#d-015
import { randomUUID } from "node:crypto";
import type { SQLInputValue, StatementSync } from "node:sqlite";
import { type Compilable, DummyDriver, Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from "kysely";
import type { Db } from "../db/db.ts";
import type { Database } from "../db/schema.ts";

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

/** Full-text index tables (virtual; not in the generated schema): joined by rowid, searched with MATCH. */
interface FtsTables {
  memories_fts: { rowid: number; text: string };
}

/** The query builder. It never runs anything itself: queries are compiled and executed by `sql(db)`. */
export const qb = new Kysely<Database & FtsTables>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});

/** Prepared statements are reused by their SQL text; the set of distinct queries is small and fixed. */
const MAX_STATEMENTS = 500;

export function sql(db: Db) {
  const statements = new Map<string, StatementSync>();
  const prepare = (text: string): StatementSync => {
    let st = statements.get(text);
    if (!st) {
      if (statements.size >= MAX_STATEMENTS) statements.clear();
      st = db.prepare(text);
      statements.set(text, st);
    }
    return st;
  };
  const compiled = (q: Compilable<unknown>) => {
    const c = q.compile();
    // SQLite has no boolean type: true/false are stored as 1/0.
    const params = c.parameters.map((p) => (typeof p === "boolean" ? Number(p) : p)) as SQLInputValue[];
    return { st: prepare(c.sql), params };
  };

  return {
    /** The first row of a query, typed by its selection. */
    one<O>(q: Compilable<O>): O | undefined {
      const { st, params } = compiled(q);
      return st.get(...params) as O | undefined;
    },
    all<O>(q: Compilable<O>): O[] {
      const { st, params } = compiled(q);
      return st.all(...params) as O[];
    },
    /** An insert, update or delete; how many rows it changed. */
    run(q: Compilable<unknown>): number {
      const { st, params } = compiled(q);
      return Number(st.run(...params).changes);
    },
    /** Runs `fn` in one transaction; nested calls join the outer one. */
    tx<T>(fn: () => T): T {
      if (db.isTransaction) return fn();
      db.exec("BEGIN");
      try {
        const out = fn();
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

export type Sql = ReturnType<typeof sql>;

/** An optional field: present only when the column has a non-empty value. */
export const opt = <K extends string>(key: K, v: unknown): { [P in K]?: string } =>
  (v === null || v === undefined || v === "" ? {} : { [key]: String(v) }) as { [P in K]?: string };
