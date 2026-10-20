import { qb, type Sql } from "./sql.ts";

export type MemorySnapshot = {
  start: number;
  length: number;
  agent_id: string;
  project_id?: string | undefined;
  notes: Array<{ id: string; revision: number }>;
  sources: string[];
};
export type LogEntry = { seq: number; run_id: string | undefined; item: unknown; memory?: MemorySnapshot | undefined };

export function modelLogRepo({ one, all, run }: Sql) {
  const log = {
    /** The thread's log, oldest first; `limit` keeps the newest entries. */
    list(threadId: string, limit = 2000): LogEntry[] {
      const newest = qb
        .selectFrom("model_log")
        .selectAll()
        .where("thread_id", "=", threadId)
        .orderBy("seq", "desc")
        .limit(limit);
      return all(qb.selectFrom(newest.as("l")).select(["seq", "run_id", "item", "memory_snapshot"]).orderBy("seq")).map(
        (r) => ({
          seq: Number(r.seq),
          run_id: r.run_id ? r.run_id : undefined,
          item: JSON.parse(r.item),
          ...(r.memory_snapshot ? { memory: JSON.parse(r.memory_snapshot) as MemorySnapshot } : {}),
        }),
      );
    },
    forRun(runId: string): unknown[] {
      return all(qb.selectFrom("model_log").select("item").where("run_id", "=", runId).orderBy("seq")).map((r) =>
        JSON.parse(r.item),
      );
    },
    /** Forgets what these runs logged and everything logged after them, so the model never sees it again. */
    dropRuns(threadId: string, runIds: string[]): void {
      const first = log.firstOf(threadId, runIds);
      if (first === undefined) return;
      run(qb.deleteFrom("model_log").where("thread_id", "=", threadId).where("seq", ">=", first));
    },
    /** The first seq these runs logged in the thread: where what they saw starts. */
    firstOf(threadId: string, runIds: string[]): number | undefined {
      if (!runIds.length) return undefined;
      const r = one(
        qb
          .selectFrom("model_log")
          .select((eb) => eb.fn.min("seq").as("seq"))
          .where("thread_id", "=", threadId)
          .where("run_id", "in", runIds),
      );
      return r?.seq == null ? undefined : Number(r.seq);
    },
    /** Copies a thread's log below `before` into another, same seqs, so a copied compaction epoch still points right. */
    copyInto(from: string, to: string, before = Number.POSITIVE_INFINITY): void {
      const rows = all(
        qb
          .selectFrom("model_log")
          .select(["seq", "run_id", "item", "memory_snapshot"])
          .where("thread_id", "=", from)
          .$if(Number.isFinite(before), (q) => q.where("seq", "<", before))
          .orderBy("seq"),
      );
      for (const r of rows)
        run(
          qb
            .insertInto("model_log")
            .values({ thread_id: to, seq: r.seq, item: r.item, run_id: r.run_id, memory_snapshot: r.memory_snapshot }),
        );
    },
    /** Appends items in order; returns the seq of the first one. */
    append(threadId: string, runId: string | undefined, items: unknown[], memory?: MemorySnapshot): number {
      const base = Number(
        one(
          qb
            .selectFrom("model_log")
            .select((eb) => eb.fn.coalesce(eb.fn.max("seq"), eb.lit(0)).as("m"))
            .where("thread_id", "=", threadId),
        )?.m ?? 0,
      );
      for (const [i, item] of items.entries())
        run(
          qb.insertInto("model_log").values({
            thread_id: threadId,
            seq: base + i + 1,
            item: JSON.stringify(item),
            run_id: runId ?? null,
            memory_snapshot: memory ? JSON.stringify(memory) : null,
          }),
        );
      return base + 1;
    },
  };
  return log;
}
