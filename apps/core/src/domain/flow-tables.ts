// Tables a project's Flows save rows to by name and read back (DECISIONS.md#d-173). A table exists once a row is
// saved in it; each row is one key's latest value, so saving under a key again replaces it.
import type { Db } from "../db/db.ts";
import { redactedJson } from "../log.ts";
import { FlowCapacityError } from "./flow-events.ts";
import { now, qb, sql } from "./sql.ts";

const MAX_ROWS = 1000;
const MAX_TABLES = 100;
const MAX_ALL = 10000;
const MAX_VALUE = 32768;

export type FlowTableRow = { key: string; value: unknown; updated_at: string };
export type FlowTableInfo = { name: string; rows: number; updated_at: string };

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

export function flowTablesRepo(db: Db) {
  const { one, all, run, tx } = sql(db);
  const count = (project?: string, name?: string) => {
    let q = qb.selectFrom("flow_tables").select((e) => e.fn.countAll<number>().as("n"));
    if (project !== undefined) q = q.where("project_id", "=", project);
    if (name !== undefined) q = q.where("name", "=", name);
    return Number(one(q)?.n ?? 0);
  };
  /** The project's tables, the most recently changed first. */
  const list = (project: string): FlowTableInfo[] =>
    all(
      qb
        .selectFrom("flow_tables")
        .select((e) => ["name", e.fn.countAll<number>().as("rows"), e.fn.max("updated_at").as("updated_at")])
        .where("project_id", "=", project)
        .groupBy("name")
        .orderBy("updated_at", "desc")
        .limit(MAX_TABLES),
    ).map((r) => ({ name: r.name, rows: Number(r.rows), updated_at: String(r.updated_at) }));
  return {
    list,
    /** Saves `value` under `key`, replacing the row that key had. */
    write(project: string, name: string, key: string, value: unknown): FlowTableRow {
      const k = flowRowKey(key);
      const text = JSON.stringify(value);
      if (text === undefined || Buffer.byteLength(text) > MAX_VALUE) throw new Error("Flow value exceeds 32 KiB");
      const stored = redactedJson(value);
      return tx(() => {
        const exists = one(
          qb
            .selectFrom("flow_tables")
            .select("key")
            .where("project_id", "=", project)
            .where("name", "=", name)
            .where("key", "=", k),
        );
        if (!exists) {
          if (count(project, name) === 0 && list(project).length >= MAX_TABLES)
            throw new FlowCapacityError("The project has too many tables");
          if (count(project, name) >= MAX_ROWS) throw new FlowCapacityError("Flow table is full");
          if (count() >= MAX_ALL) throw new FlowCapacityError("Flow tables are full");
        }
        const at = now();
        run(
          qb
            .insertInto("flow_tables")
            .values({ project_id: project, name, key: k, value: stored, updated_at: at })
            .onConflict((oc) =>
              oc.columns(["project_id", "name", "key"]).doUpdateSet({ value: stored, updated_at: at }),
            ),
        );
        return { key: k, value: JSON.parse(stored) as unknown, updated_at: at };
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
