import type { Db } from "../db/db.ts";
import { FlowCapacityError } from "./flow-events.ts";

/** Called inside the publication transaction so pruning rolls back if the new revision cannot commit. */
export function retainFlowGraphRevisions(db: Db, flow: string) {
  const candidates = `SELECT r.flow_id,r.revision FROM flow_graph_revisions r
    WHERE NOT EXISTS (SELECT 1 FROM flow_graph_drafts d WHERE d.flow_id=r.flow_id AND d.published_revision=r.revision)
      AND NOT EXISTS (SELECT 1 FROM flow_graph_events e WHERE e.flow_id=r.flow_id AND e.revision=r.revision)
      AND NOT EXISTS (SELECT 1 FROM flow_graph_nodes n WHERE n.flow_id=r.flow_id AND n.revision=r.revision)`;
  const prune = (needed: number, scoped: boolean) => {
    if (needed <= 0) return;
    const rows = db
      .prepare(`${candidates}${scoped ? " AND r.flow_id=?" : ""} ORDER BY r.created_at,r.flow_id,r.revision LIMIT ?`)
      .all(...(scoped ? [flow, needed] : [needed]));
    if (rows.length !== needed)
      throw new FlowCapacityError("Flow revision capacity is pinned by publications or event history");
    for (const row of rows)
      db.prepare("DELETE FROM flow_graph_revisions WHERE flow_id=? AND revision=?").run(
        String(row.flow_id),
        Number(row.revision),
      );
  };
  prune(Number(db.prepare("SELECT count(*) AS n FROM flow_graph_revisions WHERE flow_id=?").get(flow)?.n) - 99, true);
  prune(Number(db.prepare("SELECT count(*) AS n FROM flow_graph_revisions").get()?.n) - 9999, false);
}
