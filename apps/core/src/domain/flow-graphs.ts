import { FlowDraftGraph, FlowGraph, FlowGraphDocument } from "../../../../packages/protocol/src/flow-graph.ts";
import type { Db } from "../db/db.ts";
import { redactedJson } from "../log.ts";
import { checkFlowCapacity, FlowCapacityError } from "./flow-events.ts";
import { type FlowHistoryKind, flowGraphHistory } from "./flow-graph-history.ts";
import { retainFlowGraphRevisions } from "./flow-graph-retention.ts";
import { storedFlowValue } from "./flow-graph-runs.ts";
import { isFlowTrigger } from "./flow-graph-validate.ts";
import { sql } from "./sql.ts";

export class FlowGraphConflict extends Error {}
export class FlowGraphUnavailable extends Error {}
/** An event's run deadline, fixed at admission (DECISIONS.md#d-167). */
export const FLOW_RUN_MS = 600_000;
const object = (data: unknown) => data !== null && typeof data === "object" && !Array.isArray(data);
/** The same rule as legacy admission: only a nonempty object can start a webhook's run; a schedule's needs none. */
const runnable = (data: unknown, trigger: FlowGraph["nodes"][number]["kind"] | undefined) =>
  object(data) && (trigger === "schedule" || Object.keys(data as object).length > 0);

/** What started an event: a POST, its schedule or the owner's "Run now", and when a schedule had it due. */
export type FlowEventSource = { source: "webhook" | "schedule" | "owner"; scheduledAt?: string | undefined };
/** The event came by a way its Flow does not start from (a POST to a schedule Flow, a tick of a webhook one). */
export class FlowTriggerMismatch extends Error {}

/** What a save leaves in the Flow's history: who saved it (null for the owner) and what it was. */
export type FlowSave = { by: string | null; kind?: Exclude<FlowHistoryKind, "published">; restoredFrom?: number };

/** The trigger kind a published Flow starts from, or undefined when it runs no drawing. */
export function publishedFlowTrigger(db: Db, flow: string): "webhook" | "schedule" | undefined {
  const row = db
    .prepare(
      "SELECT r.graph FROM flow_graph_drafts d JOIN flow_graph_revisions r ON r.flow_id=d.flow_id AND r.revision=d.published_revision WHERE d.flow_id=?",
    )
    .get(flow);
  if (!row) return undefined;
  const trigger = FlowGraph.parse(JSON.parse(String(row.graph))).nodes.find(isFlowTrigger);
  return trigger?.kind === "schedule" ? "schedule" : "webhook";
}

export function hasPublishedFlowGraph(db: Db, flow: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM flow_graph_drafts WHERE flow_id=? AND published_revision IS NOT NULL").get(flow),
  );
}

export function flowGraphsRepo(db: Db) {
  const tx = sql(db).tx;
  const history = flowGraphHistory(db);
  const found = (flow: string) => {
    const row = db.prepare("SELECT enabled FROM flows WHERE id=?").get(flow);
    if (!row) throw new Error("Flow not found");
    return row;
  };
  /** A draft may keep empty settings; what is published parses as a drawing that runs (DECISIONS.md#d-177). */
  const encoded = (value: FlowDraftGraph, schema: typeof FlowGraph | typeof FlowDraftGraph = FlowGraph) => {
    const graph = schema.parse(value);
    const text = JSON.stringify(graph);
    if (Buffer.byteLength(text) > 131072) throw new Error("Graph exceeds 128 KiB");
    if (redactedJson(graph) !== text) throw new Error("Flow configuration cannot contain credentials");
    return text;
  };
  /** Admits an event on a pinned drawing, inside the caller's transaction. */
  const enter = (
    flow: string,
    event: string,
    payload: unknown,
    now: Date,
    authorize: (graph: FlowGraph) => void,
    from: FlowEventSource,
    pinned: { revision: number; graph: FlowGraph; test: boolean },
    headers: Record<string, string> | undefined,
  ) => {
    // Checked against the revision pinned here: a schedule Flow never takes a POST, a webhook one never ticks.
    const trigger = pinned.graph.nodes.find(isFlowTrigger)?.kind;
    if (from.source !== "owner" && from.source !== trigger)
      throw new FlowTriggerMismatch("The Flow does not start that way");
    if (!event || event.length > 256 || redactedJson(event) !== JSON.stringify(event))
      throw new Error("Invalid event id");
    if (db.prepare("SELECT 1 FROM flow_events WHERE flow_id=? AND event_id=?").get(flow, event))
      return { state: "duplicate" as const };
    // The same bound every step's value has (size after redaction, depth): data its first step could not carry is
    // refused here instead of stalling the Flow's queue.
    const text = storedFlowValue(payload);
    if (Number(db.prepare("SELECT count(*) AS n FROM flow_events").get()?.n) >= 10000)
      throw new FlowCapacityError("Flow event capacity exceeded");
    if (Number(db.prepare("SELECT count(*) AS n FROM flow_events WHERE flow_id=?").get(flow)?.n) >= 10000)
      throw new FlowCapacityError("Flow event capacity exceeded");
    const runs = runnable(JSON.parse(text), trigger);
    if (runs) {
      authorize(pinned.graph);
      checkFlowCapacity(db, flow);
    }
    const state = runs ? ("pending" as const) : ("ignored" as const);
    const at = now.toISOString();
    db.prepare(
      "INSERT INTO flow_events(flow_id,event_id,state,created_at,executor,source,scheduled_at,test,headers) VALUES (?,?,?,?,'graph-v2',?,?,?,?)",
    ).run(
      flow,
      event,
      state,
      at,
      from.source,
      from.scheduledAt ?? null,
      Number(pinned.test),
      headers ? redactedJson(headers) : null,
    );
    db.prepare(
      "INSERT INTO flow_graph_events(flow_id,event_id,revision,payload,deadline_at,state,ended_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      flow,
      event,
      pinned.revision,
      text,
      new Date(now.getTime() + FLOW_RUN_MS).toISOString(),
      state,
      runs ? null : at,
    );
    if (runs)
      for (const node of pinned.graph.nodes)
        db.prepare(
          "INSERT INTO flow_graph_nodes(flow_id,event_id,revision,node_id,state) VALUES (?,?,?,?,'pending')",
        ).run(flow, event, pinned.revision, node.id);
    return { state, revision: pinned.revision };
  };
  const api = {
    history,
    /** What the published drawing starts from; undefined when the Flow runs no drawing. */
    trigger: (flow: string) => publishedFlowTrigger(db, flow),
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
        draftBy: draft && !draft.discarded && draft.saved_by ? String(draft.saved_by) : null,
        publishedRevision: revision,
        published: published ? JSON.parse(String(published.graph)) : null,
        executionAvailable: true,
      });
    },
    /**
     * `by`: the agent the draft is kept as drawn by (it waits for the owner's review); none for the owner. `save`: what
     * the history keeps of it, by default a draft saved by `by`.
     */
    saveDraft(
      flow: string,
      expectedVersion: number | null,
      graph: FlowDraftGraph,
      by?: string,
      save: FlowSave = { by: by ?? null },
    ) {
      const text = encoded(graph, FlowDraftGraph);
      return tx(() => {
        const current = api.get(flow);
        if (current.draftVersion !== expectedVersion)
          throw new FlowGraphConflict("Flow draft changed; refresh before saving");
        // The drawing that runs keeps no second copy: nothing is left to discard before retiring.
        const published = current.published !== null && JSON.stringify(current.published) === text;
        db.prepare(`INSERT INTO flow_graph_drafts(flow_id,version,graph,discarded,saved_by) VALUES (?,1,?,?,?)
          ON CONFLICT(flow_id) DO UPDATE SET version=version+1,graph=excluded.graph,discarded=excluded.discarded,
          saved_by=excluded.saved_by`).run(flow, published ? "{}" : text, Number(published), by ?? null);
        history.record(flow, text, JSON.parse(text).nodes.length, {
          kind: save.kind ?? "draft",
          by: save.by,
          ...(save.restoredFrom ? { restoredFrom: save.restoredFrom } : {}),
        });
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
      check: (graph: FlowDraftGraph) => void,
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
        history.record(flow, text, current.draft.nodes.length, { kind: "published", revision });
        return api.get(flow);
      });
    },
    /**
     * One transaction with the `(flow,event)` dedup: the event, its revision, redacted payload, deadline and steps.
     * Data that cannot start a run is recorded as ignored, with no steps. `headers`: the few a POST brought worth
     * showing, already chosen and redacted.
     */
    admit(
      flow: string,
      event: string,
      payload: unknown,
      now: Date,
      authorize: (graph: FlowGraph) => void,
      from: FlowEventSource = { source: "webhook" },
      headers?: Record<string, string>,
    ) {
      return tx(() => {
        if (!found(flow).enabled) throw new Error("Flow is disabled");
        const current = api.get(flow);
        if (!current.published || current.publishedRevision === null) throw new Error("Flow has no published graph");
        const pinned = { revision: current.publishedRevision, graph: current.published, test: false };
        return enter(flow, event, payload, now, authorize, from, pinned, headers);
      });
    },
    /**
     * The drawing an owner's test runs, kept as a revision marked as a test so its runs can point at it; the same
     * drawing tested again reuses it (DECISIONS.md#d-178). Never what new events run.
     */
    testRevision(flow: string, graph: FlowGraph): number {
      const text = encoded(graph);
      return tx(() => {
        found(flow);
        const same = db
          .prepare(
            "SELECT revision FROM flow_graph_revisions WHERE flow_id=? AND test=1 AND graph=? ORDER BY revision DESC LIMIT 1",
          )
          .get(flow, text);
        if (same) return Number(same.revision);
        retainFlowGraphRevisions(db, flow);
        const revision =
          Number(db.prepare("SELECT max(revision) AS n FROM flow_graph_revisions WHERE flow_id=?").get(flow)?.n ?? 0) +
          1;
        db.prepare("INSERT INTO flow_graph_revisions(flow_id,revision,graph,created_at,test) VALUES (?,?,?,?,1)").run(
          flow,
          revision,
          text,
          new Date().toISOString(),
        );
        return revision;
      });
    },
    /**
     * A test's event, run on the drawing pinned when the owner started the test, whether the Flow is on or off; `graph`
     * is that drawing's text, so a revision number pruned and given again never runs another drawing.
     */
    admitTest(
      flow: string,
      event: string,
      payload: unknown,
      now: Date,
      { revision, graph }: { revision: number; graph: string },
      authorize: (graph: FlowGraph) => void,
      from: FlowEventSource,
      headers?: Record<string, string>,
    ) {
      return tx(() => {
        found(flow);
        const row = db
          .prepare("SELECT graph FROM flow_graph_revisions WHERE flow_id=? AND revision=? AND test=1")
          .get(flow, revision);
        if (!row || String(row.graph) !== graph) throw new FlowGraphConflict("The tested drawing is gone");
        const pinned = { revision, graph: FlowGraph.parse(JSON.parse(String(row.graph))), test: true };
        return enter(flow, event, payload, now, authorize, from, pinned, headers);
      });
    },
  };
  return api;
}
