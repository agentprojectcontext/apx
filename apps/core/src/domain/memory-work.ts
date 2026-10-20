import type { Selectable } from "kysely";
import { sql as raw } from "kysely";
import type { MemoryWorkTable } from "../db/schema.ts";
import { cosine, ftsQuery, relatedCut } from "./memories.ts";
import { memoryFragments } from "./memory-content.ts";
import { now, qb, type Sql } from "./sql.ts";

export type MemoryWork = Selectable<MemoryWorkTable>;
export type MemoryEpisode = {
  run_id: string;
  thread_id: string;
  agent_id: string;
  project_id: string | null;
  message_id: string;
  text: string;
  created_at: string;
  excerpt?: string;
};

export function memoryWorkRepo({ all, one, run, tx }: Sql) {
  return {
    enqueue(job: {
      id: string;
      kind: "capture" | "dream";
      agent_id: string;
      thread_id: string;
      run_id: string;
      project_id?: string | undefined;
    }): void {
      const at = now();
      run(
        qb
          .insertInto("memory_work")
          .values({
            ...job,
            project_id: job.project_id ?? null,
            state: "pending",
            available_at: at,
            created_at: at,
            updated_at: at,
          })
          .onConflict((c) => c.column("id").doNothing()),
      );
    },
    pending(limit = 20): MemoryWork[] {
      const at = now();
      run(
        qb
          .updateTable("memory_work")
          .set({ state: "failed", lease_until: null, updated_at: at, error: "retry limit reached after interruption" })
          .where("state", "=", "working")
          .where("attempts", ">=", 3)
          .where("lease_until", "<", at),
      );
      return all(
        qb
          .selectFrom("memory_work")
          .selectAll()
          .where((eb) =>
            eb.or([
              eb.and([eb("state", "=", "pending"), eb("available_at", "<=", at)]),
              eb.and([eb("state", "=", "working"), eb("lease_until", "<", at)]),
            ]),
          )
          .where("attempts", "<", 3)
          .orderBy("created_at", "desc")
          .orderBy("id")
          .limit(limit),
      );
    },
    claim(id: string): MemoryWork | undefined {
      return tx(() => {
        const at = now();
        const changed = run(
          qb
            .updateTable("memory_work")
            .set({
              state: "working",
              lease_until: new Date(Date.now() + 120_000).toISOString(),
              updated_at: at,
              attempts: raw`attempts + 1`,
            })
            .where("id", "=", id)
            .where("attempts", "<", 3)
            .where((eb) =>
              eb.or([eb("state", "=", "pending"), eb.and([eb("state", "=", "working"), eb("lease_until", "<", at)])]),
            ),
        );
        return changed ? one(qb.selectFrom("memory_work").selectAll().where("id", "=", id)) : undefined;
      });
    },
    reserve(id: string, limit: number): boolean {
      return tx(() => {
        const today = new Date().toISOString().slice(0, 10);
        const used = Number(
          one(
            qb
              .selectFrom("memory_call_reservations")
              .select((eb) => eb.fn.countAll<number>().as("n"))
              .where("day", "=", today),
          )?.n ?? 0,
        );
        if (used >= limit) return false;
        const changed =
          run(
            qb
              .updateTable("memory_work")
              .set({ reservation: raw`reservation + 1`, updated_at: now() })
              .where("id", "=", id)
              .where("state", "=", "working"),
          ) > 0;
        if (changed) run(qb.insertInto("memory_call_reservations").values({ job_id: id, day: today }));
        return changed;
      });
    },
    finish(id: string, state: "completed" | "failed" | "pending", result: object, error?: string): void {
      run(
        qb
          .updateTable("memory_work")
          .set({
            state,
            lease_until: null,
            updated_at: now(),
            available_at: new Date(Date.now() + 60_000).toISOString(),
            result: JSON.stringify(result),
            error: error ?? null,
          })
          .where("id", "=", id),
      );
    },
    defer(id: string, reason: string, availableAt = new Date(Date.now() + 60_000).toISOString()): void {
      run(
        qb
          .updateTable("memory_work")
          .set({
            state: "pending",
            lease_until: null,
            attempts: raw`max(0, attempts - 1)`,
            available_at: availableAt,
            error: reason,
          })
          .where("id", "=", id),
      );
    },
    recent(limit = 20) {
      return all(
        qb
          .selectFrom("memory_work")
          .select(["id", "kind", "agent_id", "thread_id", "state", "attempts", "updated_at", "result", "error"])
          .orderBy("updated_at", "desc")
          .limit(limit),
      );
    },
    uncheckedEpisodes(limit = 32): string[] {
      return all(
        qb
          .selectFrom("runs as r")
          .leftJoin("memory_episode_scans as s", "s.run_id", "r.id")
          .select("r.id")
          .where("r.state", "=", "completed")
          .where("s.run_id", "is", null)
          .orderBy("r.ended_at", "desc")
          .orderBy("r.id")
          .limit(limit),
      ).map((r) => r.id);
    },
    checkEpisode(id: string, visit: () => void): void {
      tx(() => {
        visit();
        run(
          qb
            .insertInto("memory_episode_scans")
            .values({ run_id: id })
            .onConflict((c) => c.column("run_id").doNothing()),
        );
      });
    },
    episode(e: MemoryEpisode): void {
      const { excerpt: _, ...row } = e;
      run(
        qb
          .insertInto("memory_episodes")
          .values(row)
          .onConflict((c) => c.column("run_id").doNothing()),
      );
    },
    searchEpisodes(query: string, threadIds: string[], limit = 12, excludeRuns: string[] = []): MemoryEpisode[] {
      const match = ftsQuery(query, 12);
      if (!match || !threadIds.length) return [];
      return all(
        qb
          .selectFrom("memory_episodes_fts")
          .innerJoin("memory_episodes", "memory_episodes.rowid", "memory_episodes_fts.rowid")
          .selectAll("memory_episodes")
          .where(raw<boolean>`memory_episodes.thread_id in (select value from json_each(${JSON.stringify(threadIds)}))`)
          .where(raw<boolean>`memory_episodes_fts MATCH ${match}`)
          .where(
            raw<boolean>`memory_episodes.run_id not in (select value from json_each(${JSON.stringify(excludeRuns)}))`,
          )
          .orderBy(raw`bm25(memory_episodes_fts)`)
          .limit(limit),
      );
    },
    unindexed(model: string, limit = 32) {
      return all(
        qb
          .selectFrom("memory_episodes")
          .select(["run_id", "text"])
          .where((eb) => eb.or([eb("embedding_model", "is", null), eb("embedding_model", "!=", model)]))
          .orderBy("created_at", "desc")
          .limit(limit),
      );
    },
    setEmbeddings(id: string, vectors: Float32Array[], model: string): void {
      const first = vectors[0];
      if (!first) return;
      tx(() => {
        run(qb.deleteFrom("memory_episode_vectors").where("run_id", "=", id));
        run(
          qb
            .updateTable("memory_episodes")
            .set({
              embedding: new Uint8Array(first.buffer, first.byteOffset, first.byteLength),
              embedding_model: model,
            })
            .where("run_id", "=", id),
        );
        vectors.slice(1).forEach((v, part) => {
          run(
            qb.insertInto("memory_episode_vectors").values({
              run_id: id,
              part: part + 1,
              embedding: new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
            }),
          );
        });
      });
    },
    nearest(
      threadIds: string[],
      vector: Float32Array,
      model: string,
      limit = 8,
      excludeRuns: string[] = [],
    ): MemoryEpisode[] {
      if (!threadIds.length) return [];
      const rows = all(
        qb
          .selectFrom("memory_episodes")
          .leftJoin("memory_episode_vectors as v", "v.run_id", "memory_episodes.run_id")
          .selectAll("memory_episodes")
          .select(["v.embedding as extra_embedding", "v.part as extra_part"])
          .where(raw<boolean>`thread_id in (select value from json_each(${JSON.stringify(threadIds)}))`)
          .where("embedding_model", "=", model)
          .where(
            raw<boolean>`memory_episodes.run_id not in (select value from json_each(${JSON.stringify(excludeRuns)}))`,
          )
          .where("memory_episodes.embedding", "is not", null),
      );
      const matches = new Map<string, { r: MemoryEpisode; score: number }>();
      for (const { extra_embedding, extra_part, ...r } of rows) {
        const scoreOf = (b: Uint8Array | null) =>
          b ? cosine(vector, new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))) : -Infinity;
        const first = scoreOf(r.embedding),
          extra = scoreOf(extra_embedding);
        const score = Math.max(first, extra);
        if (score > (matches.get(r.run_id)?.score ?? -Infinity)) {
          const part = extra > first ? (extra_part ?? 0) : 0;
          matches.set(r.run_id, { r: { ...r, excerpt: memoryFragments(r.text)[part] }, score });
        }
      }
      const scored = [...matches.values()].sort((a, b) => b.score - a.score);
      const cut = relatedCut(scored.map((x) => x.score));
      return scored
        .filter((x) => x.score >= cut)
        .slice(0, limit)
        .map((x) => x.r);
    },
  };
}
