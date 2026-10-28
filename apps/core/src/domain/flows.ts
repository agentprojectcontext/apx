import { FlowDefinition as Definition } from "../../../../packages/protocol/src/flow-methods.ts";
import type { Db } from "../db/db.ts";
import { redactedJson } from "../log.ts";
import { matchesFlowPredicates } from "./flow-evaluate.ts";
import { checkFlowCapacity, FlowCapacityError, flowEventsRepo } from "./flow-events.ts";
import { FlowGraphUnavailable, hasPublishedFlowGraph } from "./flow-graphs.ts";
import { checkFlowIdentifier, retireFlow } from "./flow-retirement.ts";
import { sql } from "./sql.ts";

export type FlowDefinition = Definition;
const MAX_EVENTS = 10000;
const MAX_ROWS = 1000;
const jsonValue = (value: unknown) => {
  const text = JSON.stringify(value);
  if (text === undefined || Buffer.byteLength(text) > 32768) throw new Error("Flow value exceeds 32 KiB");
  return redactedJson(value);
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
  checkFlowIdentifier(db, flow.id);
  if (hasPublishedFlowGraph(db, flow.id))
    throw new FlowGraphUnavailable("Published graph configuration cannot be replaced by a legacy definition");
  if (redactedJson(flow) !== JSON.stringify(flow))
    throw new Error("Flow definitions must use secret references, not credentials");
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
    rows(id: string, limit: number, cursor = "") {
      return db
        .prepare("SELECT key,value FROM flow_rows WHERE flow_id=? AND key>? ORDER BY key LIMIT ?")
        .all(id, cursor, limit)
        .map((r) => ({ key: String(r.key), value: JSON.parse(String(r.value)) as unknown }));
    },
    rowsPage(id: string, limit: number, cursor?: string) {
      const found = api.rows(id, limit + 1, cursor);
      const rows = found.slice(0, limit);
      return { rows, nextCursor: found.length > limit ? (rows.at(-1)?.key ?? null) : null };
    },
    write(id: string, key: string, value: unknown) {
      if (!key || key.length > 128 || redactedJson(key) !== JSON.stringify(key))
        throw new Error("Invalid flow row key");
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
    ...flowEventsRepo(db),
    retire: (id: string) => retireFlow(db, id),
    receive(flowId: string, eventId: string, payload: unknown): "duplicate" | "ignored" | "written" | "pending" {
      if (!eventId || eventId.length > 256 || redactedJson(eventId) !== JSON.stringify(eventId))
        throw new Error("Invalid event id");
      const value = jsonValue(payload);
      const data: unknown = JSON.parse(value);
      return tx(() => {
        const flow = api.get(flowId);
        if (!flow?.enabled) throw new Error("Flow not found or disabled");
        if (hasPublishedFlowGraph(db, flowId)) throw new FlowGraphUnavailable("Graph execution is not available yet");
        if (db.prepare("SELECT 1 FROM flow_events WHERE flow_id=? AND event_id=?").get(flowId, eventId))
          return "duplicate";
        if (Number(db.prepare("SELECT count(*) AS n FROM flow_events WHERE flow_id=?").get(flowId)?.n) >= MAX_EVENTS)
          throw new FlowCapacityError("Flow event history is full");
        if (Number(db.prepare("SELECT count(*) AS n FROM flow_events").get()?.n) >= 10000)
          throw new FlowCapacityError("Flow event history is full");
        const matches =
          data !== null &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          Object.keys(data).length > 0 &&
          matchesFlowPredicates(data, flow.predicates);
        const state = !matches ? "ignored" : flow.action.kind === "none" ? "written" : "pending";
        if (state === "pending") checkFlowCapacity(db, flowId);
        const reads = matches
          ? (flow.readKeys ?? []).map((key) => {
              const row = db.prepare("SELECT value FROM flow_rows WHERE flow_id=? AND key=?").get(flowId, key);
              return { key, value: row ? (JSON.parse(String(row.value)) as unknown) : null };
            })
          : [];
        const snapshot = reads.length ? jsonValue({ event: data, rows: reads }) : value;
        if (matches) api.write(flowId, flow.tableKey, data);
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
