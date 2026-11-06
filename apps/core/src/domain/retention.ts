// What store retention reads and rewrites: finished runs by how far they were trimmed, their steps' kept outputs and
// their model log rows. The rules of what may change live in engine/store-retention.ts. See DECISIONS.md#d-200
import { qb, type Sql } from "./sql.ts";

/** How far a finished run's stored copies were trimmed. */
export const TRIMMED = { none: 0, outputs: 1, stubbed: 2, compacted: 3 } as const;
export type Trimmed = (typeof TRIMMED)[keyof typeof TRIMMED];

export type LogRow = { seq: number; run_id: string | undefined; item: string };

const REF = "read_output ref=";

export function retentionRepo({ one, all, run }: Sql) {
  return {
    /** Finished runs below `level`, oldest end first; `endedBefore` keeps the recent ones out. */
    due(
      level: Trimmed,
      limit: number,
      endedBefore?: string,
    ): Array<{ id: string; thread_id: string; trimmed: number }> {
      return all(
        qb
          .selectFrom("runs")
          .select(["id", "thread_id", "trimmed"])
          .where("trimmed", "<", level)
          .where("ended_at", "is not", null)
          .$if(endedBefore !== undefined, (q) => q.where("ended_at", "<", endedBefore as string))
          .where("state", "in", ["completed", "failed", "canceled"])
          .orderBy("trimmed")
          .orderBy("ended_at")
          .limit(limit),
      );
    },
    mark(runId: string, level: Trimmed): void {
      run(qb.updateTable("runs").set({ trimmed: level }).where("id", "=", runId).where("trimmed", "<", level));
    },
    /** Steps of the run that still keep a whole output. */
    keptOutputs(runId: string): string[] {
      return all(qb.selectFrom("steps").select("id").where("run_id", "=", runId).where("output", "is not", null)).map(
        (r) => r.id,
      );
    },
    /** Step ids the run's logged tool results point read_output at: the outputs the model was told it may read. */
    referenced(runId: string): Set<string> {
      const rows = all(
        qb
          .selectFrom("model_log")
          .select("item")
          .where("run_id", "=", runId)
          .where((eb) => eb(eb.fn("instr", ["item", eb.val(REF)]), ">", 0)),
      );
      const ids = new Set<string>();
      for (const r of rows)
        for (const m of r.item.matchAll(/read_output ref=([A-Za-z0-9_]+)/g)) ids.add(m[1] as string);
      return ids;
    },
    dropOutputs(stepIds: string[]): number {
      if (!stepIds.length) return 0;
      return run(qb.updateTable("steps").set({ output: null }).where("id", "in", stepIds));
    },
    /** Each thread holding the run's log (its own, and forks that copied it) with the seq span it covers there. */
    spans(runId: string): Array<{ thread_id: string; first: number; last: number }> {
      return all(
        qb
          .selectFrom("model_log")
          .select((eb) => ["thread_id", eb.fn.min("seq").as("first"), eb.fn.max("seq").as("last")])
          .where("run_id", "=", runId)
          .groupBy("thread_id"),
      ).map((r) => ({ thread_id: r.thread_id, first: Number(r.first), last: Number(r.last) }));
    },
    /** The newest seq in a thread's log: its view changes only when this does (or its summary does). */
    lastSeq(threadId: string): number {
      const r = one(
        qb
          .selectFrom("model_log")
          .select((eb) => eb.fn.max("seq").as("seq"))
          .where("thread_id", "=", threadId),
      );
      return Number(r?.seq ?? 0);
    },
    /** A thread's log rows from `first` to `last`, as stored. */
    rows(threadId: string, first: number, last: number): LogRow[] {
      return all(
        qb
          .selectFrom("model_log")
          .select(["seq", "run_id", "item"])
          .where("thread_id", "=", threadId)
          .where("seq", ">=", first)
          .where("seq", "<=", last)
          .orderBy("seq"),
      ).map((r) => ({ seq: Number(r.seq), run_id: r.run_id ?? undefined, item: r.item }));
    },
    rewrite(threadId: string, seq: number, item: string): void {
      run(qb.updateTable("model_log").set({ item }).where("thread_id", "=", threadId).where("seq", "=", seq));
    },
    /** Whether the thread has a turn that is not finished: its log may be read or written now. */
    live(threadId: string): boolean {
      return !!one(
        qb
          .selectFrom("runs")
          .select("id")
          .where("thread_id", "=", threadId)
          .where("state", "in", ["queued", "submitted", "working", "input-required"])
          .limit(1),
      );
    },
  };
}
