import { FlowGraph, FlowGraphDocument } from "../../../../packages/protocol/src/flow-graph.ts";
import type { Db } from "../db/db.ts";
import { redactedJson } from "../log.ts";
import { checkFlowCapacity, FlowCapacityError } from "./flow-events.ts";
import { retainFlowGraphRevisions } from "./flow-graph-retention.ts";
import { sql } from "./sql.ts";

export class FlowGraphConflict extends Error {}
export class FlowGraphUnavailable extends Error {}
/** An event's run deadline, fixed at admission (DECISIONS.md#d-167). */
export const FLOW_RUN_MS = 600_000;
/** The same rule as legacy admission: only a nonempty object can start a run. */
const runnable = (data: unknown) =>
  data !== null && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length > 0;

export function hasPublishedFlowGraph(db: Db, flow: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM flow_graph_drafts WHERE flow_id=? AND published_revision IS NOT NULL").get(flow),
  );
}

export function flowGraphsRepo(db: Db) {
  const tx = sql(db).tx;
  const found = (flow: string) => {
    const row = db.prepare("SELECT enabled FROM flows WHERE id=?").get(flow);
    if (!row) throw new Error("Flow not found");
    return row;
  };
  const encoded = (value: FlowGraph) => {
    const graph = FlowGraph.parse(value);
    const text = JSON.stringify(graph);
    if (Buffer.byteLength(text) > 131072) throw new Error("Graph exceeds 128 KiB");
    if (redactedJson(graph) !== text) throw new Error("Flow configuration cannot contain credentials");
    return text;
  };
  const api = {
    get(flow: string) {
      found(flow);
      const draft = db.prepare("SELECT * FROM flow_graph_drafts WHERE flow_id=?").get(flow);
      const revision = draft?.published_revision == null ? null : Number(draft.published_revision);
      const published =
        revision === null
          ? undefined
          : db.prepare("SELECT graph FROM flow_graph_revisions WHERE flow_id=? AND revision=?").get(flow, revision);
      return FlowGraphDocument.parse({
        flow,
        draftVersion: draft ? Number(draft.version) : null,
        draft: draft && !draft.discarded ? JSON.parse(String(draft.graph)) : null,
        publishedRevision: revision,
        published: published ? JSON.parse(String(published.graph)) : null,
        executionAvailable: true,
      });
    },
    saveDraft(flow: string, expectedVersion: number | null, graph: FlowGraph) {
      const text = encoded(graph);
      return tx(() => {
        const current = api.get(flow);
        if (current.draftVersion !== expectedVersion)
          throw new FlowGraphConflict("Flow draft changed; refresh before saving");
        // The drawing that runs keeps no second copy: nothing is left to discard before retiring.
        const published = current.published !== null && JSON.stringify(current.published) === text;
        db.prepare(`INSERT INTO flow_graph_drafts(flow_id,version,graph,discarded) VALUES (?,1,?,?)
          ON CONFLICT(flow_id) DO UPDATE SET version=version+1,graph=excluded.graph,discarded=excluded.discarded`).run(
          flow,
          published ? "{}" : text,
          Number(published),
        );
        return api.get(flow);
      });
    },
    discardDraft(flow: string, expectedVersion: number) {
      return tx(() => {
        const current = api.get(flow);
        if (current.draftVersion !== expectedVersion || !current.draft)
          throw new FlowGraphConflict("Flow draft changed; refresh before discarding");
        if (current.publishedRevision !== null)
          throw new FlowGraphConflict("Published graphs cannot be discarded without a complete graph export");
        db.prepare("UPDATE flow_graph_drafts SET version=version+1,graph='{}',discarded=1 WHERE flow_id=?").run(flow);
        return api.get(flow);
      });
    },
    /**
     * The draft becomes the next immutable revision and new events run it; events already admitted keep theirs.
     * `check` validates the draft inside the transaction (bindings, models), so what is published is what passed.
     */
    publish(
      flow: string,
      expectedDraftVersion: number,
      expectedPublishedRevision: number | null,
      check: (graph: FlowGraph) => void,
    ) {
      return tx(() => {
        found(flow);
        const current = api.get(flow);
        if (current.draftVersion !== expectedDraftVersion || current.publishedRevision !== expectedPublishedRevision)
          throw new FlowGraphConflict("Flow changed; refresh before publishing");
        if (!current.draft) throw new FlowGraphConflict("There are no changes to publish");
        check(current.draft);
        const text = encoded(current.draft);
        retainFlowGraphRevisions(db, flow);
        const revision =
          Number(db.prepare("SELECT max(revision) AS n FROM flow_graph_revisions WHERE flow_id=?").get(flow)?.n ?? 0) +
          1;
        db.prepare("INSERT INTO flow_graph_revisions(flow_id,revision,graph,created_at) VALUES (?,?,?,?)").run(
          flow,
          revision,
          text,
          new Date().toISOString(),
        );
        db.prepare(
          "UPDATE flow_graph_drafts SET version=version+1,graph='{}',discarded=1,published_revision=? WHERE flow_id=?",
        ).run(revision, flow);
        return api.get(flow);
      });
    },
    /**
     * One transaction with the `(flow,event)` dedup: the event, its revision, redacted payload, deadline and steps.
     * Data that cannot start a run is recorded as ignored, with no steps.
     */
    admit(flow: string, event: string, payload: unknown, now: Date, authorize: (graph: FlowGraph) => void) {
      return tx(() => {
        if (!found(flow).enabled) throw new Error("Flow is disabled");
        const current = api.get(flow);
        if (!current.published || current.publishedRevision === null) throw new Error("Flow has no published graph");
        if (!event || event.length > 256 || redactedJson(event) !== JSON.stringify(event))
          throw new Error("Invalid event id");
        if (db.prepare("SELECT 1 FROM flow_events WHERE flow_id=? AND event_id=?").get(flow, event))
          return { state: "duplicate" as const };
        const raw = JSON.stringify(payload);
        if (raw === undefined || Buffer.byteLength(raw) > 32768) throw new Error("Flow value exceeds 32 KiB");
        const text = redactedJson(payload);
        if (Number(db.prepare("SELECT count(*) AS n FROM flow_events").get()?.n) >= 10000)
          throw new FlowCapacityError("Flow event capacity exceeded");
        if (Number(db.prepare("SELECT count(*) AS n FROM flow_events WHERE flow_id=?").get(flow)?.n) >= 10000)
          throw new FlowCapacityError("Flow event capacity exceeded");
        const runs = runnable(JSON.parse(text));
        if (runs) {
          authorize(current.published);
          checkFlowCapacity(db, flow);
        }
        const state = runs ? ("pending" as const) : ("ignored" as const);
        const at = now.toISOString();
        db.prepare(
          "INSERT INTO flow_events(flow_id,event_id,state,created_at,executor) VALUES (?,?,?,?,'graph-v2')",
        ).run(flow, event, state, at);
        db.prepare(
          "INSERT INTO flow_graph_events(flow_id,event_id,revision,payload,deadline_at,state,ended_at) VALUES (?,?,?,?,?,?,?)",
        ).run(
          flow,
          event,
          current.publishedRevision,
          text,
          new Date(now.getTime() + FLOW_RUN_MS).toISOString(),
          state,
          runs ? null : at,
        );
        if (runs)
          for (const node of current.published.nodes)
            db.prepare(
              "INSERT INTO flow_graph_nodes(flow_id,event_id,revision,node_id,state) VALUES (?,?,?,?,'pending')",
            ).run(flow, event, current.publishedRevision, node.id);
        return { state, revision: current.publishedRevision };
      });
    },
  };
  return api;
}
