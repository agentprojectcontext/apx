// Small key/value settings, external harness session ids per thread, and stored idempotent responses.
import { now, qb, type Sql } from "./sql.ts";

export function settingsRepo({ one, run }: Sql) {
  const key = (k: string) => `setting:${k}`;
  return {
    get(k: string): string | undefined {
      return one(qb.selectFrom("meta").select("value").where("key", "=", key(k)))?.value;
    },
    set(k: string, value: string): void {
      run(
        qb
          .insertInto("meta")
          .values({ key: key(k), value })
          .onConflict((c) => c.column("key").doUpdateSet({ value })),
      );
    },
  };
}

export function harnessSessionsRepo({ one, run }: Sql) {
  const row = (threadId: string, harness: string) =>
    one(
      qb
        .selectFrom("harness_sessions")
        .select(["session_id", "updated_at"])
        .where("thread_id", "=", threadId)
        .where("harness", "=", harness),
    );
  return {
    get: (threadId: string, harness: string): string | undefined => row(threadId, harness)?.session_id,
    updatedAt: (threadId: string, harness: string): string | undefined => row(threadId, harness)?.updated_at,
    set(threadId: string, harness: string, sessionId: string): void {
      const at = now();
      run(
        qb
          .insertInto("harness_sessions")
          .values({ thread_id: threadId, harness, session_id: sessionId, updated_at: at })
          .onConflict((c) =>
            c.columns(["thread_id", "harness"]).doUpdateSet({ session_id: sessionId, updated_at: at }),
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
