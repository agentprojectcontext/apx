import { FlowDefinition as Definition, FlowEvent } from "../../../../packages/protocol/src/flow-methods.ts";
import type { Db } from "../db/db.ts";
import { matchesFlowPredicates } from "./flow-evaluate.ts";
import { sql } from "./sql.ts";

export type FlowDefinition = Definition;
const MAX_EVENTS = 10000;
const MAX_ROWS = 1000;
export class FlowCapacityError extends Error {}
const occupied =
  "SELECT count(*) AS n FROM flow_events e LEFT JOIN runs r ON r.id=e.run_id WHERE (e.state='pending' OR (e.state='admitted' AND r.ended_at IS NULL))";
const jsonValue = (value: unknown) => {
  const text = JSON.stringify(value);
  if (text === undefined || Buffer.byteLength(text) > 32768) throw new Error("Flow value exceeds 32 KiB");
  return text;
};
type SavedFlow = {
  id: string;
  project_id: string;
  name: string;
  enabled: number;
  predicates: string;
  table_key: string;
  action: string;
  read_keys: string;
};
const definition = (row: SavedFlow) =>
  Definition.parse({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    enabled: Boolean(row.enabled),
    predicates: JSON.parse(row.predicates),
    tableKey: row.table_key,
    action: JSON.parse(row.action),
    readKeys: JSON.parse(row.read_keys),
  });

export function saveFlow(db: Db, value: FlowDefinition): void {
  const flow = Definition.parse(value);
  matchesFlowPredicates({}, flow.predicates);
  const result = db
    .prepare(`INSERT INTO flows(id, project_id, name, enabled, predicates, table_key, action, read_keys) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, enabled=excluded.enabled, predicates=excluded.predicates, table_key=excluded.table_key, action=excluded.action, read_keys=excluded.read_keys
    WHERE flows.project_id=excluded.project_id`)
    .run(
      flow.id,
      flow.projectId,
      flow.name,
      Number(flow.enabled),
      JSON.stringify(flow.predicates),
      flow.tableKey,
      JSON.stringify(flow.action),
      JSON.stringify(flow.readKeys ?? []),
    );
  if (!result.changes) throw new Error("Flow belongs to another project");
}

export function flowsRepo(db: Db) {
  const tx = sql(db).tx;
  const api = {
    get(id: string): FlowDefinition | undefined {
      const row = db.prepare("SELECT * FROM flows WHERE id=?").get(id) as SavedFlow | undefined;
      return row ? definition(row) : undefined;
    },
    list(project?: string): FlowDefinition[] {
      const rows =
        project === undefined
          ? db.prepare("SELECT * FROM flows ORDER BY id LIMIT 1000").all()
          : db.prepare("SELECT * FROM flows WHERE project_id=? ORDER BY id LIMIT 1000").all(project);
      return (rows as SavedFlow[]).map(definition);
    },
    save(flow: FlowDefinition) {
      if (!api.get(flow.id) && Number(db.prepare("SELECT count(*) AS n FROM flows").get()?.n) >= 1000)
        throw new Error("Too many flows");
      saveFlow(db, flow);
      return api.get(flow.id) as FlowDefinition;
    },
    rows(id: string, limit: number) {
      return db
        .prepare("SELECT key,value FROM flow_rows WHERE flow_id=? ORDER BY key LIMIT ?")
        .all(id, limit)
        .map((r) => ({ key: String(r.key), value: JSON.parse(String(r.value)) as unknown }));
    },
    write(id: string, key: string, value: unknown) {
      if (!key || key.length > 128) throw new Error("Invalid flow row key");
      const text = jsonValue(value);
      const exists = db.prepare("SELECT 1 FROM flow_rows WHERE flow_id=? AND key=?").get(id, key);
      if (!exists && Number(db.prepare("SELECT count(*) AS n FROM flow_rows WHERE flow_id=?").get(id)?.n) >= MAX_ROWS)
        throw new FlowCapacityError("Flow table is full");
      if (!exists && Number(db.prepare("SELECT count(*) AS n FROM flow_rows").get()?.n) >= 10000)
        throw new FlowCapacityError("Flow tables are full");
      db.prepare(
        "INSERT INTO flow_rows(flow_id,key,value) VALUES (?,?,?) ON CONFLICT(flow_id,key) DO UPDATE SET value=excluded.value",
      ).run(id, key, text);
      return { written: true };
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
          action: Definition.shape.action.parse(JSON.parse(String(r.action))),
          thread: r.thread_id ? String(r.thread_id) : undefined,
        }));
    },
    setThread(flow: string, event: string, thread: string) {
      db.prepare("UPDATE flow_events SET thread_id=? WHERE flow_id=? AND event_id=? AND state='pending'").run(
        thread,
        flow,
        event,
      );
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
      return tx(() => {
        if (
          !db
            .prepare("SELECT 1 FROM flow_events WHERE flow_id=? AND event_id=? AND state='failed' AND run_id IS NULL")
            .get(flow, event)
        )
          return { queued: false };
        if (
          Number(db.prepare(occupied).get()?.n) >= 256 ||
          Number(db.prepare(`${occupied} AND e.flow_id=?`).get(flow)?.n) >= 32
        )
          throw new FlowCapacityError("Flow queue is full");
        const result = db
          .prepare(
            "UPDATE flow_events SET state='pending',error=NULL WHERE flow_id=? AND event_id=? AND state='failed' AND run_id IS NULL",
          )
          .run(flow, event);
        return { queued: Boolean(result.changes) };
      });
    },
    receive(flowId: string, eventId: string, payload: unknown): "duplicate" | "ignored" | "written" | "pending" {
      if (!eventId || eventId.length > 256) throw new Error("Invalid event id");
      const value = jsonValue(payload);
      return tx(() => {
        const flow = api.get(flowId);
        if (!flow?.enabled) throw new Error("Flow not found or disabled");
        if (db.prepare("SELECT 1 FROM flow_events WHERE flow_id=? AND event_id=?").get(flowId, eventId))
          return "duplicate";
        if (Number(db.prepare("SELECT count(*) AS n FROM flow_events WHERE flow_id=?").get(flowId)?.n) >= MAX_EVENTS)
          throw new FlowCapacityError("Flow event history is full");
        if (Number(db.prepare("SELECT count(*) AS n FROM flow_events").get()?.n) >= 10000)
          throw new FlowCapacityError("Flow event history is full");
        const matches =
          payload !== null &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          Object.keys(payload).length > 0 &&
          matchesFlowPredicates(payload, flow.predicates);
        const state = !matches ? "ignored" : flow.action.kind === "none" ? "written" : "pending";
        if (
          state === "pending" &&
          (Number(db.prepare(occupied).get()?.n) >= 256 ||
            Number(db.prepare(`${occupied} AND e.flow_id=?`).get(flowId)?.n) >= 32)
        )
          throw new FlowCapacityError("Flow queue is full");
        const reads = matches
          ? (flow.readKeys ?? []).map((key) => {
              const row = db.prepare("SELECT value FROM flow_rows WHERE flow_id=? AND key=?").get(flowId, key);
              return { key, value: row ? (JSON.parse(String(row.value)) as unknown) : null };
            })
          : [];
        const snapshot = reads.length ? jsonValue({ event: payload, rows: reads }) : value;
        if (matches) api.write(flowId, flow.tableKey, payload);
        db.prepare(
          "INSERT INTO flow_events(flow_id,event_id,state,created_at,payload,action) VALUES (?,?,?,?,?,?)",
        ).run(
          flowId,
          eventId,
          state,
          new Date().toISOString(),
          state === "pending" ? snapshot : null,
          JSON.stringify(flow.action),
        );
        return state;
      });
    },
  };
  return api;
}

export const receiveFlowEvent = (db: Db, flow: string, event: string, payload: unknown) =>
  flowsRepo(db).receive(flow, event, payload);
