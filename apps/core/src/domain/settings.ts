// Small key/value settings, external harness session ids per thread, and stored idempotent responses.
import type { RunUsage } from "@apx/protocol";
import { sql as raw } from "kysely";
import { type Entry, SETTINGS, type SettingKey, type SettingValue } from "./setting-keys.ts";
import { now, qb, type Sql } from "./sql.ts";

export function settingsRepo({ one, run }: Sql) {
  const key = (k: string) => `setting:${k}`;
  const get = (k: string): string | undefined =>
    one(qb.selectFrom("meta").select("value").where("key", "=", key(k)))?.value;
  const set = (k: string, value: string): void => {
    run(
      qb
        .insertInto("meta")
        .values({ key: key(k), value })
        .onConflict((c) => c.column("key").doUpdateSet({ value })),
    );
  };
  return {
    /** A plain-text setting, or one whose key is built per item (see `read` for the JSON ones). */
    get,
    set,
    /** A JSON setting through its schema: unset, unreadable or invalid gives its fallback (a fresh copy). */
    read<K extends SettingKey>(k: K): SettingValue<K> {
      const { schema, fallback } = SETTINGS[k] as Entry<SettingValue<K>>;
      const raw = get(k);
      if (raw !== undefined) {
        try {
          const v = schema.safeParse(JSON.parse(raw));
          if (v.success) return v.data;
        } catch {}
      }
      return structuredClone(fallback);
    },
    write<K extends SettingKey>(k: K, value: SettingValue<K>): void {
      set(k, JSON.stringify(value));
    },
  };
}

export function harnessSessionsRepo({ one, all, run }: Sql) {
  const row = (threadId: string, harness: string) =>
    one(
      qb
        .selectFrom("harness_sessions")
        .select(["session_id", "updated_at", "usage"])
        .where("thread_id", "=", threadId)
        .where("harness", "=", harness),
    );
  return {
    get: (threadId: string, harness: string): string | undefined => row(threadId, harness)?.session_id,
    /** The APX thread that already goes on with an outside session, if one does. */
    threadOf: (harness: string, sessionId: string): string | undefined =>
      one(
        qb
          .selectFrom("harness_sessions")
          .select("thread_id")
          .where("harness", "=", harness)
          .where("session_id", "=", sessionId),
      )?.thread_id,
    /** Every outside session id APX goes on with, for one harness. */
    sessionIds: (harness: string): Set<string> =>
      new Set(
        all(qb.selectFrom("harness_sessions").select("session_id").where("harness", "=", harness)).map(
          (r) => r.session_id,
        ),
      ),
    updatedAt: (threadId: string, harness: string): string | undefined => row(threadId, harness)?.updated_at,
    /** The tokens an outside session had spent by its last turn here, for an engine that only reports its total. */
    total(threadId: string, harness: string, sessionId: string): RunUsage | undefined {
      const r = row(threadId, harness);
      return r?.session_id === sessionId && r.usage ? (JSON.parse(r.usage) as RunUsage) : undefined;
    },
    /** Another session drops the old one's total; `total` is the new running total, when the engine gave one. */
    set(threadId: string, harness: string, sessionId: string, total?: RunUsage): void {
      const at = now();
      const usage = total ? JSON.stringify(total) : null;
      run(
        qb
          .insertInto("harness_sessions")
          .values({ thread_id: threadId, harness, session_id: sessionId, updated_at: at, usage })
          .onConflict((c) =>
            c.columns(["thread_id", "harness"]).doUpdateSet({
              session_id: sessionId,
              updated_at: at,
              usage: usage ?? raw<string | null>`CASE WHEN session_id = ${sessionId} THEN usage END`,
            }),
          ),
      );
    },
  };
}

export function idempotencyRepo({ one, run }: Sql) {
  return {
    get(key: string, method: string): unknown | undefined {
      const r = one(
        qb.selectFrom("idempotency").select("response").where("key", "=", key).where("method", "=", method),
      );
      return r ? JSON.parse(r.response) : undefined;
    },
    put(key: string, method: string, response: unknown): void {
      run(qb.replaceInto("idempotency").values({ key, method, response: JSON.stringify(response), created_at: now() }));
    },
    prune(maxAgeMs = 24 * 3600_000): void {
      run(qb.deleteFrom("idempotency").where("created_at", "<", new Date(Date.now() - maxAgeMs).toISOString()));
    },
  };
}
