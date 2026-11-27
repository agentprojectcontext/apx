// Auto's decisions (DECISIONS.md#d-281, DECISIONS.md#d-283): one row per deletion or call it weighed, kept 90 days for
// the owner's review.
import { type AutoDecision, DecisionReason } from "@apx/protocol";
import { type Selectable, sql } from "kysely";
import type { AutoDecisionsTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

const KEEP_DAYS = 90;

export type AutoDecisionRecord = Omit<AutoDecision, "id" | "at"> & {
  run_id?: string | undefined;
  call_id?: string | undefined;
};

const strings = (text: string): string[] => {
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

function decision(r: Selectable<AutoDecisionsTable>): AutoDecision {
  return {
    id: r.id,
    at: r.at,
    kind: r.kind === "action" ? "action" : "deletion",
    ...opt("tool", r.tool),
    thread_id: r.thread_id,
    agent_id: r.agent_id,
    ...opt("project_id", r.project_id),
    command: r.command,
    items: strings(r.items),
    verdict: r.verdict === "run" ? "run" : "ask",
    by: r.decided_by === "judge" ? "judge" : "rule",
    reasons: strings(r.reasons).flatMap((x) => (DecisionReason.safeParse(x).success ? [x as DecisionReason] : [])),
    ...opt("why", r.why),
    ...opt("model", r.model),
  };
}

export function autoDecisionsRepo({ all, run }: Sql) {
  return {
    add(d: AutoDecisionRecord): AutoDecision {
      const id = newId("adl");
      const at = now();
      run(
        qb.insertInto("auto_decisions").values({
          id,
          at,
          thread_id: d.thread_id,
          run_id: d.run_id ?? null,
          call_id: d.call_id ?? null,
          agent_id: d.agent_id,
          project_id: d.project_id ?? null,
          command: d.command,
          items: JSON.stringify(d.items),
          kind: d.kind,
          tool: d.tool ?? null,
          verdict: d.verdict,
          decided_by: d.by,
          reasons: JSON.stringify(d.reasons),
          why: d.why ?? null,
          model: d.model ?? null,
        }),
      );
      run(
        qb.deleteFrom("auto_decisions").where("at", "<", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()),
      );
      const { run_id: _run, call_id: _call, ...shown } = d;
      return { id, at, ...shown };
    },
    /** Newest first; `next` (the last one's id) is the `before` of the following page. */
    page({
      limit,
      before,
      verdict,
    }: {
      limit: number;
      before?: string | undefined;
      verdict?: "run" | "ask" | undefined;
    }): { decisions: AutoDecision[]; next?: string } {
      // Rows in the order they were written: two in the same millisecond keep theirs.
      let q = qb.selectFrom("auto_decisions").selectAll();
      if (before)
        q = q.where(
          sql`rowid`,
          "<",
          qb.selectFrom("auto_decisions").select(sql<number>`rowid`.as("r")).where("id", "=", before),
        );
      if (verdict) q = q.where("verdict", "=", verdict);
      const rows = all(q.orderBy(sql`rowid`, "desc").limit(limit + 1));
      const decisions = rows.slice(0, limit).map(decision);
      const last = decisions.at(-1);
      return { decisions, ...(rows.length > limit && last ? { next: last.id } : {}) };
    },
  };
}
