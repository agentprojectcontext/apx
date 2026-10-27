import type { Db } from "../db/db.ts";
import { type FlowPredicate, matchesFlowPredicates } from "./flow-evaluate.ts";

export type FlowDefinition = {
  id: string;
  projectId: string;
  enabled: boolean;
  predicates: FlowPredicate[];
  tableKey: string;
};

export function saveFlow(db: Db, flow: FlowDefinition): void {
  if (!flow.id || !flow.projectId || !flow.tableKey || flow.id.length > 128 || flow.tableKey.length > 128) {
    throw new Error("Invalid flow definition");
  }
  matchesFlowPredicates({}, flow.predicates);
  const result = db
    .prepare(`INSERT INTO flows(id, project_id, enabled, predicates, table_key) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, predicates=excluded.predicates, table_key=excluded.table_key
    WHERE flows.project_id=excluded.project_id`)
    .run(flow.id, flow.projectId, Number(flow.enabled), JSON.stringify(flow.predicates), flow.tableKey);
  if (!result.changes) throw new Error("Flow belongs to another project");
}

// Admission, deduplication and the deterministic write commit together.
export function receiveFlowEvent(
  db: Db,
  flowId: string,
  eventId: string,
  payload: unknown,
): "duplicate" | "ignored" | "written" {
  if (!eventId || eventId.length > 256) throw new Error("Invalid event id");
  const value = JSON.stringify(payload);
  if (value === undefined || Buffer.byteLength(value) > 65536) throw new Error("Invalid event payload");
  db.exec("BEGIN IMMEDIATE");
  try {
    const flow = db.prepare("SELECT enabled, predicates, table_key FROM flows WHERE id = ?").get(flowId) as
      | { enabled: number; predicates: string; table_key: string }
      | undefined;
    if (!flow?.enabled) throw new Error("Flow not found or disabled");
    const inserted = db
      .prepare("INSERT OR IGNORE INTO flow_events(flow_id, event_id, state, created_at) VALUES (?, ?, 'ignored', ?)")
      .run(flowId, eventId, new Date().toISOString());
    if (!inserted.changes) {
      db.exec("COMMIT");
      return "duplicate";
    }
    const matches =
      payload !== null &&
      typeof payload === "object" &&
      Object.keys(payload).length > 0 &&
      matchesFlowPredicates(payload, JSON.parse(flow.predicates) as FlowPredicate[]);
    if (matches) {
      db.prepare(`INSERT INTO flow_rows(flow_id, key, value) VALUES (?, ?, ?)
        ON CONFLICT(flow_id, key) DO UPDATE SET value=excluded.value`).run(flowId, flow.table_key, value);
      db.prepare("UPDATE flow_events SET state='written' WHERE flow_id=? AND event_id=?").run(flowId, eventId);
    }
    db.exec("COMMIT");
    return matches ? "written" : "ignored";
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
