import { FlowAction, FlowEvent } from "../../../../packages/protocol/src/flow-methods.ts";
import type { Db } from "../db/db.ts";
import { sql } from "./sql.ts";

export class FlowCapacityError extends Error {}
const occupied =
  "SELECT count(*) AS n FROM flow_events e LEFT JOIN runs r ON r.id=e.run_id WHERE (e.state='pending' OR (e.state='admitted' AND r.ended_at IS NULL))";

export function checkFlowCapacity(db: Db, flow: string) {
  if (
    Number(db.prepare(occupied).get()?.n) >= 256 ||
    Number(db.prepare(`${occupied} AND e.flow_id=?`).get(flow)?.n) >= 32
  )
    throw new FlowCapacityError("Flow queue is full");
}

export function flowEventsRepo(db: Db) {
  return {
    admissionInput(flow: string, event: string) {
      const row = db
        .prepare("SELECT payload,action FROM flow_events WHERE flow_id=? AND event_id=? AND state='pending'")
        .get(flow, event);
      if (!row) throw new Error("Flow event is no longer pending");
      return {
        flow,
        id: event,
        data: JSON.parse(String(row.payload)) as unknown,
        action: FlowAction.parse(JSON.parse(String(row.action))),
      };
    },
    events(id: string, limit: number) {
      return db
        .prepare(
          "SELECT e.flow_id,e.event_id,e.state,e.created_at,e.run_id,r.state AS run_state,e.error FROM flow_events e LEFT JOIN runs r ON r.id=e.run_id WHERE flow_id=? ORDER BY e.created_at DESC,e.event_id DESC LIMIT ?",
        )
        .all(id, limit)
        .map((r) => FlowEvent.parse(r));
    },
    pending(limit = 20, after = 0) {
      return db
        .prepare(
          "SELECT e.rowid AS cursor,e.flow_id,e.event_id,e.payload,e.action,e.thread_id FROM flow_events e JOIN flows f ON f.id=e.flow_id WHERE e.state='pending' AND f.enabled=1 AND e.rowid>? ORDER BY e.rowid LIMIT ?",
        )
        .all(after, limit)
        .map((r) => ({
          cursor: Number(r.cursor),
          flow: String(r.flow_id),
          event: String(r.event_id),
          payload: JSON.parse(String(r.payload)) as unknown,
          action: FlowAction.parse(JSON.parse(String(r.action))),
          thread: r.thread_id ? String(r.thread_id) : undefined,
        }));
    },
    setThread(flow: string, event: string, thread: string) {
      const changed = db
        .prepare(
          "UPDATE flow_events SET thread_id=? WHERE flow_id=? AND event_id=? AND state='pending' AND thread_id IS NULL",
        )
        .run(thread, flow, event);
      if (!changed.changes) throw new Error("Flow event already has a thread or is no longer pending");
    },
    admitted(flow: string, event: string, run: string) {
      const changed = db
        .prepare(
          "UPDATE flow_events SET state='admitted', run_id=?, error=NULL WHERE flow_id=? AND event_id=? AND state='pending'",
        )
        .run(run, flow, event);
      if (!changed.changes) throw new Error("Flow event is no longer pending");
    },
    fail(flow: string, event: string) {
      db.prepare(
        "UPDATE flow_events SET state='failed',error='Action could not be admitted; review its binding before retrying' WHERE flow_id=? AND event_id=? AND state='pending'",
      ).run(flow, event);
    },
    retry(flow: string, event: string) {
      return sql(db).tx(() => {
        if (
          !db
            .prepare("SELECT 1 FROM flow_events WHERE flow_id=? AND event_id=? AND state='failed' AND run_id IS NULL")
            .get(flow, event)
        )
          return { queued: false };
        checkFlowCapacity(db, flow);
        const result = db
          .prepare(
            "UPDATE flow_events SET state='pending',error=NULL WHERE flow_id=? AND event_id=? AND state='failed' AND run_id IS NULL",
          )
          .run(flow, event);
        return { queued: Boolean(result.changes) };
      });
    },
  };
}
