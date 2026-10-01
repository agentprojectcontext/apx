// Small helpers shared by the repositories. Rows come back as plain records; each repo maps its own.
import { randomUUID } from "node:crypto";
import type { Db } from "../db/db.ts";

export type Row = Record<string, unknown>;

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

export function sql(db: Db) {
  return {
    one: (q: string, ...args: unknown[]) => db.prepare(q).get(...(args as never[])) as Row | undefined,
    all: (q: string, ...args: unknown[]) => db.prepare(q).all(...(args as never[])) as Row[],
    run: (q: string, ...args: unknown[]) => db.prepare(q).run(...(args as never[])),
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

export const opt = <K extends string>(key: K, v: unknown): { [P in K]?: string } =>
  (v === null || v === undefined || v === "" ? {} : { [key]: String(v) }) as { [P in K]?: string };
