import type { Db } from "../db/db.ts";
import { sql } from "./sql.ts";

export function checkFlowIdentifier(db: Db, id: string) {
  if (db.prepare("SELECT 1 FROM retired_flows WHERE id=?").get(id))
    throw new Error("Flow identifier was retired; choose a new identifier");
}

export function retireFlow(db: Db, id: string) {
  return sql(db).tx(() => {
    const flow = db.prepare("SELECT enabled FROM flows WHERE id=?").get(id);
    if (!flow) return { retired: false };
    if (flow.enabled) throw new Error("Disable the Flow before retiring it");
    // Unpublished changes would be lost silently; a published drawing is part of the export.
    if (db.prepare("SELECT 1 FROM flow_graph_drafts WHERE flow_id=? AND discarded=0").get(id))
      throw new Error("Publish or discard the Flow's unpublished changes before retiring it");
    const active =
      db
        .prepare(
          "SELECT 1 FROM flow_events e JOIN runs r ON r.id=e.run_id WHERE e.flow_id=? AND r.ended_at IS NULL LIMIT 1",
        )
        .get(id) ??
      db.prepare("SELECT 1 FROM flow_graph_events WHERE flow_id=? AND state='pending' LIMIT 1").get(id) ??
      db
        .prepare(
          "SELECT 1 FROM flow_graph_nodes n JOIN runs r ON r.id=n.run_id WHERE n.flow_id=? AND r.ended_at IS NULL LIMIT 1",
        )
        .get(id);
    if (active) throw new Error("Cancel or finish the Flow's active runs before retiring it");
    if (Number(db.prepare("SELECT count(*) AS n FROM retired_flows").get()?.n) >= 10000)
      throw new Error("Flow retirement capacity exceeded");
    db.prepare("INSERT INTO retired_flows(id) VALUES (?)").run(id);
    db.prepare("DELETE FROM flows WHERE id=?").run(id);
    return { retired: true };
  });
}
