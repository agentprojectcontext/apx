import { FlowAction, FlowEvent, type FlowEventCursor } from "../../../../packages/protocol/src/flow-methods.ts";
import type { Db } from "../db/db.ts";
import { sql } from "./sql.ts";

// Fresh tokens of the linked run, counted like runs.ts does; null without a run or before it reports usage.
const runTokens =
  "CASE WHEN r.usage IS NULL THEN NULL ELSE max(coalesce(json_extract(r.usage,'$.input'),0)-coalesce(json_extract(r.usage,'$.cached'),0),0)+coalesce(json_extract(r.usage,'$.output'),0) END";

// Which executor admitted the event and the version it ran: a legacy event is a previous version once a graph is
// published; a graph event is the current one while its revision is still the published one.
const shape = `CASE WHEN e.executor='legacy' THEN 'legacy' ELSE 'graph' END AS executor, g.revision AS revision,
  CASE WHEN e.executor='legacy' THEN d.published_revision IS NULL ELSE g.revision IS d.published_revision END AS current,
  e.stopped_at AS stopped_at, g.stopped_by AS stopped_by, g.ended_at AS ended_at, e.source AS source,
  e.scheduled_at AS scheduled_at, EXISTS(SELECT 1 FROM flow_graph_nodes n WHERE n.flow_id=e.flow_id AND
  n.event_id=e.event_id AND n.error IN ('owner_cancelled','cancelled_after_send')) AS cancelled_by_owner`;

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
  const api = {
    admissionInput(flow: string, event: string) {
      const row = db
        .prepare(
          "SELECT payload,action FROM flow_events WHERE flow_id=? AND event_id=? AND executor='legacy' AND state='pending'",
        )
        .get(flow, event);
      if (!row) throw new Error("Flow event is no longer pending");
      return {
        flow,
        id: event,
        data: JSON.parse(String(row.payload)) as unknown,
        action: FlowAction.parse(JSON.parse(String(row.action))),
      };
    },
    events(id: string, limit: number, cursor?: FlowEventCursor) {
      return db
        .prepare(
          `SELECT e.flow_id,e.event_id,e.state,e.created_at,e.run_id,r.state AS run_state,e.error,r.started_at AS run_started_at,r.ended_at AS run_ended_at,${runTokens} AS run_tokens,${shape} FROM flow_events e LEFT JOIN runs r ON r.id=e.run_id LEFT JOIN flow_graph_events g ON g.flow_id=e.flow_id AND g.event_id=e.event_id LEFT JOIN flow_graph_drafts d ON d.flow_id=e.flow_id WHERE e.flow_id=? AND (? IS NULL OR e.created_at<? OR (e.created_at=? AND e.event_id<?)) ORDER BY e.created_at DESC,e.event_id DESC LIMIT ?`,
        )
        .all(
          id,
          cursor?.createdAt ?? null,
          cursor?.createdAt ?? null,
          cursor?.createdAt ?? null,
          cursor?.eventId ?? null,
          limit,
        )
        .map((r) =>
          FlowEvent.parse({ ...r, current: Boolean(r.current), cancelled_by_owner: Boolean(r.cancelled_by_owner) }),
        );
    },
    eventsPage(id: string, limit: number, cursor?: FlowEventCursor) {
      const found = api.events(id, limit + 1, cursor);
      const events = found.slice(0, limit);
      const last = events.at(-1);
      return {
        events,
        nextCursor: found.length > limit && last ? { createdAt: last.created_at, eventId: last.event_id } : null,
      };
    },
    pending(limit = 20, after = 0) {
      return db
        .prepare(
          "SELECT e.rowid AS cursor,e.flow_id,e.event_id,e.payload,e.action,e.thread_id FROM flow_events e JOIN flows f ON f.id=e.flow_id WHERE e.executor='legacy' AND e.state='pending' AND f.enabled=1 AND e.rowid>? ORDER BY e.rowid LIMIT ?",
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
          "UPDATE flow_events SET thread_id=? WHERE flow_id=? AND event_id=? AND executor='legacy' AND state='pending' AND thread_id IS NULL",
        )
        .run(thread, flow, event);
      if (!changed.changes) throw new Error("Flow event already has a thread or is no longer pending");
    },
    admitted(flow: string, event: string, run: string) {
      const changed = db
        .prepare(
          "UPDATE flow_events SET state='admitted', run_id=?, error=NULL WHERE flow_id=? AND event_id=? AND executor='legacy' AND state='pending'",
        )
        .run(run, flow, event);
      if (!changed.changes) throw new Error("Flow event is no longer pending");
    },
    fail(flow: string, event: string) {
      db.prepare(
        "UPDATE flow_events SET state='failed',error='Action could not be admitted; review its binding before retrying' WHERE flow_id=? AND event_id=? AND executor='legacy' AND state='pending'",
      ).run(flow, event);
    },
    retry(flow: string, event: string) {
      return sql(db).tx(() => {
        if (
          !db
            .prepare(
              "SELECT 1 FROM flow_events WHERE flow_id=? AND event_id=? AND executor='legacy' AND state='failed' AND run_id IS NULL",
            )
            .get(flow, event)
        )
          return { queued: false };
        checkFlowCapacity(db, flow);
        const result = db
          .prepare(
            "UPDATE flow_events SET state='pending',error=NULL WHERE flow_id=? AND event_id=? AND executor='legacy' AND state='failed' AND run_id IS NULL",
          )
          .run(flow, event);
        return { queued: Boolean(result.changes) };
      });
    },
  };
  return api;
}
