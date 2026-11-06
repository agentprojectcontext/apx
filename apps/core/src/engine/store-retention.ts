// Keeps the store from growing without bound, never changing what a model reads in a live chat. A finished run drops
// the whole outputs its model log already holds; once enough turns follow it, its long tool output is kept as the stub
// every view of the chat already shows; once it is behind any view, its encrypted reasoning goes too. See
// DECISIONS.md#d-200
import { type Db, storeRebuild, storeReclaim, storeSize } from "../db/db.ts";
import type { LogEntry } from "../domain/model-log.ts";
import { type LogRow, TRIMMED, type Trimmed } from "../domain/retention.ts";
import type { Store } from "../domain/store.ts";
import { REASONING } from "../providers/chatgpt-responses.ts";
import type { ChatItem } from "../providers/types.ts";
import type { BackgroundCheck } from "./background.ts";
import { FULL_OUTPUT_RUNS, HISTORY_BUDGET_CHARS, historyGroups, project, pruneOutput } from "./context.ts";

const DAY = 86_400_000;

const RETENTION = {
  /** A run is compacted only this long after it ended, so rewinding or forking a recent chat reads it whole. */
  keepDays: 14,
  /** Turns that must follow a run before its long output is kept as the stub (a view shows it whole for the newest). */
  stubAfterTurns: 2 * FULL_OUTPUT_RUNS,
  /** How many history budgets back from the newest turn a run must lie: no view of the chat reaches that far. */
  viewBudgets: 4,
  everyMs: 10 * 60_000,
  /** Runs (and chat views) one beat works on, so a beat never holds the core for long. */
  workPerBeat: 200,
  /** Free pages one beat gives back to the disk (100 MB of 4 KB pages). */
  pagesPerBeat: 25_600,
};

export type RetentionCounts = { runs_trimmed: number; runs_compacted: number; outputs_dropped: number; rows: number };

function withoutReasoning(item: ChatItem): ChatItem {
  if (item.role !== "assistant" || !(REASONING in item)) return item;
  const { [REASONING]: _, ...rest } = item as ChatItem & { [REASONING]?: unknown };
  return rest as ChatItem;
}

/**
 * The rows of `runId` in a stretch of one chat's log as a view past the newest turns reads them: long tool output as
 * its stub and, with `reasoning: false`, no encrypted reasoning. Unchanged rows are left out.
 */
function compactedRows(rows: LogRow[], runId: string, o: { reasoning: boolean }): Array<{ seq: number; item: string }> {
  const entries: LogEntry[] = rows.map((r) => ({ seq: r.seq, run_id: r.run_id, item: JSON.parse(r.item) }));
  const out: Array<{ seq: number; item: string }> = [];
  let at = 0;
  // The same groups the history projection makes, so a stub is the one it would show.
  for (const group of historyGroups(entries)) {
    const start = at;
    at += group.items.length;
    if (group.run !== runId) continue;
    for (const [k, item] of pruneOutput(group.items).entries()) {
      const row = rows[start + k] as LogRow;
      const next = JSON.stringify(o.reasoning ? item : withoutReasoning(item));
      if (next !== row.item) out.push({ seq: row.seq, item: next });
    }
  }
  return out;
}

/** Where a chat's widest view starts, and where each of the groups a view counts starts. */
type View = { from: number; starts: number[] };

export function createRetention(o: { store: Store; db: Db; now?: () => Date }) {
  const { store, db } = o;
  const clock = o.now ?? (() => new Date());

  // Views kept between beats, measured again only when the chat's log or summary moved.
  const views = new Map<string, { key: string; view: View }>();
  const viewOf = (threadId: string): { view: View; measured: boolean } => {
    const key = `${store.retention.lastSeq(threadId)}:${store.threads.context(threadId).compaction?.upto ?? ""}`;
    const kept = views.get(threadId);
    if (kept?.key === key) return { view: kept.view, measured: false };
    const view = measure(threadId);
    views.set(threadId, { key, view });
    return { view, measured: true };
  };
  const measure = (threadId: string): View => {
    const entries = store.modelLog.list(threadId);
    const epoch = store.threads.context(threadId).compaction;
    const from = project(entries, RETENTION.viewBudgets * HISTORY_BUDGET_CHARS, epoch).from;
    const seen = epoch ? entries.filter((e) => e.seq > epoch.upto) : entries;
    return { from, starts: historyGroups(seen).map((g) => g.seq) };
  };

  /** How far a run's log in one chat may be compacted: behind every view, stubbed, or not yet. */
  const reach = (v: View, last: number): Trimmed => {
    if (last < v.from) return TRIMMED.compacted;
    const after = v.starts.filter((seq) => seq > last).length;
    return after >= RETENTION.stubAfterTurns ? TRIMMED.stubbed : TRIMMED.outputs;
  };

  /** Drops the whole outputs of finished runs that the model never got cut: its log holds them already. */
  function trimOutputs(budget: number, counts: RetentionCounts): number {
    const due = store.retention.due(TRIMMED.outputs, budget);
    for (const r of due)
      store.tx(() => {
        const told = store.retention.referenced(r.id);
        counts.outputs_dropped += store.retention.dropOutputs(
          store.retention.keptOutputs(r.id).filter((id) => !told.has(id)),
        );
        store.retention.mark(r.id, TRIMMED.outputs);
        counts.runs_trimmed++;
      });
    return due.length;
  }

  /** Compacts runs that ended long ago as far as every chat holding their log allows. */
  function compactRuns(budget: number, counts: RetentionCounts): void {
    const before = new Date(clock().getTime() - RETENTION.keepDays * DAY).toISOString();
    let work = 0;
    for (const r of store.retention.due(TRIMMED.compacted, 1_000_000, before)) {
      if (work >= budget) return;
      const spans = store.retention.spans(r.id);
      if (spans.some((s) => store.retention.live(s.thread_id))) continue;
      const level = Math.min(
        TRIMMED.compacted,
        ...spans.map((s) => {
          const { view, measured } = viewOf(s.thread_id);
          if (measured) work++;
          return reach(view, s.last);
        }),
      ) as Trimmed;
      if (level <= r.trimmed) continue;
      work++;
      store.tx(() => {
        for (const s of spans) {
          const rows = store.retention.rows(s.thread_id, s.first, s.last);
          for (const row of compactedRows(rows, r.id, { reasoning: level < TRIMMED.compacted })) {
            store.retention.rewrite(s.thread_id, row.seq, row.item);
            counts.rows++;
          }
        }
        // A stubbed result no longer shows its read_output ref to any view.
        counts.outputs_dropped += store.retention.dropOutputs(store.retention.keptOutputs(r.id));
        store.retention.mark(r.id, level);
        counts.runs_compacted++;
      });
    }
  }

  /** One pass over what is due; `budget` bounds the work, none does it all. */
  function pass(budget = Number.POSITIVE_INFINITY): RetentionCounts {
    const counts: RetentionCounts = { runs_trimmed: 0, runs_compacted: 0, outputs_dropped: 0, rows: 0 };
    if (Number.isFinite(budget)) trimOutputs(budget, counts);
    else while (trimOutputs(5_000, counts) === 5_000);
    compactRuns(budget, counts);
    return counts;
  }

  return {
    pass,
    /**
     * Everything due now, then the free pages back to the disk: a store not yet incremental is rewritten once, which
     * needs about twice its size free. `freeBytes` is the free space on the disk holding it.
     */
    compactNow(freeBytes: number) {
      const before = storeSize(db);
      const counts = pass();
      const grown = storeSize(db);
      let reclaimed: "incremental" | "rebuilt" | "not_enough_disk" = "incremental";
      if (grown.incremental) storeReclaim(db);
      else if (freeBytes >= 2 * grown.bytes) {
        storeRebuild(db);
        reclaimed = "rebuilt";
      } else reclaimed = "not_enough_disk";
      return { ...counts, before_bytes: before.bytes, after_bytes: storeSize(db).bytes, reclaimed };
    },
    /** On the office clock: a bounded pass, then some free pages back to the disk. */
    check: {
      id: "store-retention",
      everyMs: RETENTION.everyMs,
      run: (_at: Date) => {
        pass(RETENTION.workPerBeat);
        storeReclaim(db, RETENTION.pagesPerBeat);
      },
    } satisfies BackgroundCheck,
  };
}
