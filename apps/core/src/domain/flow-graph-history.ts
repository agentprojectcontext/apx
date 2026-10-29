import type { FlowHistoryEntry } from "../../../../packages/protocol/src/flow-history.ts";
import type { Db } from "../db/db.ts";
import { qb, sql } from "./sql.ts";

/** Entries kept per Flow, besides published ones runs still point at (DECISIONS.md#d-179). */
export const FLOW_HISTORY_KEEP = 50;

export type FlowHistoryKind = FlowHistoryEntry["kind"];
type Row = {
  entry: number;
  at: string;
  kind: string;
  saved_by: string | null;
  restored_from: number | null;
  revision: number | null;
  steps: number;
};
const COLUMNS = ["entry", "at", "kind", "saved_by", "restored_from", "revision", "steps"] as const;

/** A Flow's saves that changed its drawing, newest first; written inside the save's own transaction. */
export function flowGraphHistory(db: Db) {
  const { one, all, run } = sql(db);
  const entryOf = (r: Row, name: (agent: string) => string | null): FlowHistoryEntry => ({
    entry: Number(r.entry),
    at: r.at,
    kind: r.kind as FlowHistoryKind,
    by: r.saved_by,
    byName: r.saved_by ? name(r.saved_by) : null,
    restoredFrom: r.restored_from,
    revision: r.revision,
    steps: Number(r.steps),
  });
  const newest = (flow: string) =>
    one(
      qb
        .selectFrom("flow_graph_history")
        .select([...COLUMNS, "graph"])
        .where("flow_id", "=", flow)
        .orderBy("entry", "desc")
        .limit(1),
    );
  /** Drops the oldest beyond the bound, except published entries a run or what runs still points at. */
  const prune = (flow: string) => {
    const cut = one(
      qb
        .selectFrom("flow_graph_history")
        .select("entry")
        .where("flow_id", "=", flow)
        .orderBy("entry", "desc")
        .offset(FLOW_HISTORY_KEEP - 1)
        .limit(1),
    );
    if (!cut) return;
    run(
      qb
        .deleteFrom("flow_graph_history")
        .where("flow_id", "=", flow)
        .where("entry", "<", Number(cut.entry))
        .where((e) =>
          e.or([
            e("kind", "!=", "published"),
            e("revision", "is", null),
            e.and([
              e.not(
                e.exists(
                  e
                    .selectFrom("flow_graph_events as ev")
                    .select("ev.revision")
                    .whereRef("ev.flow_id", "=", "flow_graph_history.flow_id")
                    .whereRef("ev.revision", "=", "flow_graph_history.revision"),
                ),
              ),
              e.not(
                e.exists(
                  e
                    .selectFrom("flow_graph_drafts as d")
                    .select("d.flow_id")
                    .whereRef("d.flow_id", "=", "flow_graph_history.flow_id")
                    .whereRef("d.published_revision", "=", "flow_graph_history.revision"),
                ),
              ),
            ]),
          ]),
        ),
    );
  };
  return {
    /**
     * Records a save; a drawing the same as the newest entry's leaves none. Publishing what the owner just saved as a
     * draft turns that entry into the published one, so one Save is one entry.
     */
    record(
      flow: string,
      graph: string,
      steps: number,
      what: { kind: FlowHistoryKind; by?: string | null; restoredFrom?: number; revision?: number },
    ) {
      const last = newest(flow);
      const at = new Date().toISOString();
      if (last && last.graph === graph) {
        // An agent's draft published by the owner stays two entries: who drew it, and who made it run.
        const saved = what.kind === "published" && last.kind !== "published" && !last.saved_by && !what.by;
        if (saved)
          run(
            qb
              .updateTable("flow_graph_history")
              .set({ kind: "published", revision: what.revision ?? null, at })
              .where("flow_id", "=", flow)
              .where("entry", "=", Number(last.entry)),
          );
        if (saved || what.kind !== "published") return;
      }
      run(
        qb.insertInto("flow_graph_history").values({
          flow_id: flow,
          entry: Number(last?.entry ?? 0) + 1,
          at,
          kind: what.kind,
          saved_by: what.by ?? null,
          restored_from: what.restoredFrom ?? null,
          revision: what.revision ?? null,
          steps,
          graph,
        }),
      );
      prune(flow);
    },
    list(flow: string, name: (agent: string) => string | null): FlowHistoryEntry[] {
      return all(
        qb.selectFrom("flow_graph_history").select(COLUMNS).where("flow_id", "=", flow).orderBy("entry", "desc"),
      ).map((r) => entryOf(r, name));
    },
    get(flow: string, entry: number, name: (agent: string) => string | null) {
      const r = one(
        qb
          .selectFrom("flow_graph_history")
          .select([...COLUMNS, "graph"])
          .where("flow_id", "=", flow)
          .where("entry", "=", entry),
      );
      return r ? { entry: entryOf(r, name), graph: JSON.parse(r.graph) as unknown } : undefined;
    },
  };
}
