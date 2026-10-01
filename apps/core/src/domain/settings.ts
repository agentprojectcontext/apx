// Small key/value settings, external harness session ids per thread, and stored idempotent responses.
import { now, type Sql } from "./sql.ts";

export function settingsRepo({ one, run }: Sql) {
  return {
    get(key: string): string | undefined {
      const r = one("SELECT value FROM meta WHERE key = ?", `setting:${key}`);
      return r ? String(r.value) : undefined;
    },
    set(key: string, value: string): void {
      run(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        `setting:${key}`,
        value,
      );
    },
  };
}

export function harnessSessionsRepo({ one, run }: Sql) {
  return {
    get(threadId: string, harness: string): string | undefined {
      const r = one("SELECT session_id FROM harness_sessions WHERE thread_id = ? AND harness = ?", threadId, harness);
      return r ? String(r.session_id) : undefined;
    },
    updatedAt(threadId: string, harness: string): string | undefined {
      const r = one("SELECT updated_at FROM harness_sessions WHERE thread_id = ? AND harness = ?", threadId, harness);
      return r ? String(r.updated_at) : undefined;
    },
    set(threadId: string, harness: string, sessionId: string): void {
      run(
        "INSERT INTO harness_sessions (thread_id, harness, session_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(thread_id, harness) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at",
        threadId,
        harness,
        sessionId,
        now(),
      );
    },
  };
}

export function idempotencyRepo({ one, run }: Sql) {
  return {
    get(key: string, method: string): unknown | undefined {
      const r = one("SELECT response FROM idempotency WHERE key = ? AND method = ?", key, method);
      return r ? JSON.parse(String(r.response)) : undefined;
    },
    put(key: string, method: string, response: unknown): void {
      run(
        "INSERT OR REPLACE INTO idempotency (key, method, response, created_at) VALUES (?, ?, ?, ?)",
        key,
        method,
        JSON.stringify(response),
        now(),
      );
    },
    prune(maxAgeMs = 24 * 3600_000): void {
      run("DELETE FROM idempotency WHERE created_at < ?", new Date(Date.now() - maxAgeMs).toISOString());
    },
  };
}
