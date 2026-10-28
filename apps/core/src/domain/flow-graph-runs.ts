// Checkpoints of graph runs: one row per event (its pinned revision, payload and deadline) and one per step. Every
// transition is a compare-and-set inside a transaction that also checks the run is still going, so a step runs once
// and a late answer never reopens an ended run (DECISIONS.md#d-167).
import { sql as raw } from "kysely";
import {
  FlowGraph,
  type FlowNode,
  type FlowRunDetail,
  type FlowStepRecord,
} from "../../../../packages/protocol/src/flow-graph.ts";
import type { Db } from "../db/db.ts";
import { redactedJson } from "../log.ts";
import { boundedFlowValue, type FlowNodeState } from "./flow-graph-semantics.ts";
import { qb, sql } from "./sql.ts";

export type FlowRunState = FlowRunDetail["state"];
/** Which step of which run: the revision is part of the key, so a step of another version never matches. */
export type FlowStepKey = { flow: string; event: string; revision: number; node: string };
export type FlowStepRow = {
  node: string;
  state: FlowNodeState;
  input: unknown;
  output: unknown;
  /** A model step: `reserved` before its call, `dispatched` once the call may have reached the provider. */
  phase: "reserved" | "dispatched" | null;
  run_id: string | null;
  thread_id: string | null;
};
export type FlowGraphRun = {
  flow: string;
  event: string;
  revision: number;
  graph: FlowGraph;
  payload: unknown;
  /** Absolute, fixed at admission: a restart or a pause never extends it. */
  deadline: number;
  state: FlowRunState;
  steps: Map<string, FlowStepRow>;
};

/** Stored values: bounded JSON (32 KiB) with credentials redacted, as legacy events are. */
export function storedFlowValue(value: unknown): string {
  const text = redactedJson(boundedFlowValue(value));
  // Redaction can make a value longer ("[redacted]" in place of a short token): the bound holds after it too.
  if (Buffer.byteLength(text) > 32768) throw new Error("Flow value exceeds 32 KiB");
  return text;
}
const parsed = (text: string | null): unknown => (text === null ? undefined : JSON.parse(text));
const PREVIEW = 4000;
const preview = (text: string | null) =>
  text === null
    ? { text: null, cut: false }
    : text.length > PREVIEW
      ? { text: `${text.slice(0, PREVIEW)}…`, cut: true }
      : { text, cut: false };
/** What a legacy-history row shows for a graph run once it ended. */
const EVENT_STATE: Record<FlowRunState, string> = {
  pending: "pending",
  succeeded: "succeeded",
  failed: "failed",
  uncertain: "uncertain",
  cancelled: "cancelled",
  ignored: "ignored",
};

export function flowGraphRunsRepo(db: Db) {
  const { one, all, run, tx } = sql(db);
  const going = (k: Omit<FlowStepKey, "node">) =>
    one(
      qb
        .selectFrom("flow_graph_events")
        .select("state")
        .where("flow_id", "=", k.flow)
        .where("event_id", "=", k.event)
        .where("revision", "=", k.revision),
    )?.state === "pending";
  const step = (k: FlowStepKey) =>
    qb
      .updateTable("flow_graph_nodes")
      .where("flow_id", "=", k.flow)
      .where("event_id", "=", k.event)
      .where("revision", "=", k.revision)
      .where("node_id", "=", k.node);
  const api = {
    /** Runs still going, oldest admission first. */
    active(): { flow: string; event: string; deadline: number }[] {
      return all(
        qb
          .selectFrom("flow_graph_events as g")
          .innerJoin("flow_events as e", (j) =>
            j.onRef("e.flow_id", "=", "g.flow_id").onRef("e.event_id", "=", "g.event_id"),
          )
          .select(["g.flow_id", "g.event_id", "g.deadline_at"])
          .where("g.state", "=", "pending")
          .orderBy(raw`e.rowid`),
      ).map((r) => ({ flow: r.flow_id, event: r.event_id, deadline: Date.parse(r.deadline_at) }));
    },
    load(flow: string, event: string): FlowGraphRun | undefined {
      const head = one(
        qb
          .selectFrom("flow_graph_events as g")
          .innerJoin("flow_graph_revisions as r", (j) =>
            j.onRef("r.flow_id", "=", "g.flow_id").onRef("r.revision", "=", "g.revision"),
          )
          .select(["g.revision", "g.payload", "g.deadline_at", "g.state", "r.graph"])
          .where("g.flow_id", "=", flow)
          .where("g.event_id", "=", event),
      );
      if (!head) return undefined;
      const rows = all(
        qb
          .selectFrom("flow_graph_nodes")
          .select(["node_id", "state", "input", "output", "phase", "run_id", "thread_id"])
          .where("flow_id", "=", flow)
          .where("event_id", "=", event)
          .where("revision", "=", head.revision),
      );
      return {
        flow,
        event,
        revision: head.revision,
        graph: FlowGraph.parse(JSON.parse(head.graph)),
        payload: JSON.parse(head.payload),
        deadline: Date.parse(head.deadline_at),
        state: head.state as FlowRunState,
        steps: new Map(
          rows.map((r) => [
            r.node_id,
            {
              node: r.node_id,
              state: r.state as FlowNodeState,
              input: parsed(r.input),
              output: parsed(r.output),
              phase: r.phase as FlowStepRow["phase"],
              run_id: r.run_id,
              thread_id: r.thread_id,
            },
          ]),
        ),
      };
    },
    /**
     * A database step: claim, effect and output commit together, or not at all. `effect` runs inside the
     * transaction with no await, so a crash leaves the step pending and it can run again safely.
     */
    runPure(k: FlowStepKey, input: unknown, at: Date, effect: () => unknown): boolean {
      return tx(() => {
        if (!going(k)) return false;
        const iso = at.toISOString();
        const claimed = run(
          step(k)
            .set({ state: "running", input: input === undefined ? null : storedFlowValue(input), started_at: iso })
            .where("state", "=", "pending"),
        );
        if (!claimed) return false;
        const output = storedFlowValue(effect());
        run(step(k).set({ state: "succeeded", output, ended_at: iso }));
        return true;
      });
    },
    /** Claims a step whose effect happens outside the database (a model call, a run). */
    claim(k: FlowStepKey, input: unknown, at: Date, phase: "reserved" | null): boolean {
      return tx(
        () =>
          going(k) &&
          run(
            step(k)
              .set({ state: "running", input: storedFlowValue(input), started_at: at.toISOString(), phase })
              .where("state", "=", "pending"),
          ) > 0,
      );
    },
    /** The last commit before a model call: false when the run ended or its deadline passed first. */
    dispatch(k: FlowStepKey, at: Date, deadline: number): boolean {
      return tx(
        () =>
          going(k) &&
          at.getTime() < deadline &&
          run(step(k).set({ phase: "dispatched" }).where("state", "=", "running").where("phase", "=", "reserved")) > 0,
      );
    },
    /** A step's own result, accepted only while its run is going and before its deadline. */
    succeed(k: FlowStepKey, from: FlowNodeState, output: unknown, at: Date, deadline: number): boolean {
      const text = storedFlowValue(output);
      return tx(
        () =>
          going(k) &&
          at.getTime() < deadline &&
          run(step(k).set({ state: "succeeded", output: text, ended_at: at.toISOString() }).where("state", "=", from)) >
            0,
      );
    },
    /** Moves a step on without output: skipped, blocked, failed, uncertain or cancelled. `error` is a short reason. */
    settle(k: FlowStepKey, from: readonly FlowNodeState[], to: FlowNodeState, at: Date, error?: string): boolean {
      return tx(
        () =>
          going(k) &&
          run(
            step(k)
              .set({ state: to, ended_at: at.toISOString(), error: error ?? null })
              .where("state", "in", [...from]),
          ) > 0,
      );
    },
    /** Inside the router's thread-creation transaction: the chat the step's agent works in. */
    linkThread(k: FlowStepKey, thread: string): void {
      if (
        !going(k) ||
        !run(step(k).set({ thread_id: thread }).where("state", "=", "running").where("thread_id", "is", null))
      )
        throw new Error("Flow step is no longer starting");
    },
    /** Inside the router's run-admission transaction: the run the step waits for. */
    linkRun(k: FlowStepKey, runId: string, thread?: string): void {
      let q = step(k)
        .set({ state: "waiting_run", run_id: runId })
        .where("state", "=", "running")
        .where("run_id", "is", null);
      if (thread !== undefined) q = q.where("thread_id", "=", thread);
      if (!going(k) || !run(q)) throw new Error("Flow step is no longer starting");
    },
    /** What a step that starts a run was given, for the router to check against what it is asked to start. */
    startingInput(k: FlowStepKey): unknown {
      const row = one(
        qb
          .selectFrom("flow_graph_nodes")
          .select(["input", "state"])
          .where("flow_id", "=", k.flow)
          .where("event_id", "=", k.event)
          .where("revision", "=", k.revision)
          .where("node_id", "=", k.node),
      );
      if (!going(k) || row?.state !== "running" || row.input === null)
        throw new Error("Flow step is no longer starting");
      return JSON.parse(row.input);
    },
    /** The run ended: the event's history row says how, and which check cut it short if one did. */
    finish(
      flow: string,
      event: string,
      state: Exclude<FlowRunState, "pending">,
      at: Date,
      stoppedBy?: string,
    ): boolean {
      return tx(() => {
        const changed = run(
          qb
            .updateTable("flow_graph_events")
            .set({ state, ended_at: at.toISOString(), stopped_by: stoppedBy ?? null })
            .where("flow_id", "=", flow)
            .where("event_id", "=", event)
            .where("state", "=", "pending"),
        );
        if (changed)
          run(
            qb
              .updateTable("flow_events")
              .set({ state: EVENT_STATE[state] })
              .where("flow_id", "=", flow)
              .where("event_id", "=", event),
          );
        return changed > 0;
      });
    },
    /**
     * After a restart: a model call that may have been sent is uncertain, never sent again; one reserved but not
     * sent, or a run step that admitted no run, can start over.
     */
    recover(at: Date): number {
      return tx(() => {
        const live = (q: ReturnType<typeof step> | ReturnType<typeof qb.updateTable<"flow_graph_nodes">>) =>
          q.where(({ exists, selectFrom }) =>
            exists(
              selectFrom("flow_graph_events as g")
                .select("g.event_id")
                .whereRef("g.flow_id", "=", "flow_graph_nodes.flow_id")
                .whereRef("g.event_id", "=", "flow_graph_nodes.event_id")
                .where("g.state", "=", "pending"),
            ),
          );
        const uncertain = run(
          live(qb.updateTable("flow_graph_nodes"))
            .set({ state: "uncertain", ended_at: at.toISOString(), error: "model_uncertain" })
            .where("state", "=", "running")
            .where("phase", "=", "dispatched"),
        );
        run(
          live(qb.updateTable("flow_graph_nodes"))
            .set({ state: "pending", phase: null, started_at: null, input: null })
            .where("state", "=", "running")
            .where("run_id", "is", null),
        );
        return uncertain;
      });
    },
    /** Runs a step left behind when its run ended early: each needs a cancel request until it ends. */
    orphanRuns(): string[] {
      return all(
        qb
          .selectFrom("flow_graph_nodes as n")
          .innerJoin("flow_graph_events as g", (j) =>
            j.onRef("g.flow_id", "=", "n.flow_id").onRef("g.event_id", "=", "n.event_id"),
          )
          .innerJoin("runs as r", "r.id", "n.run_id")
          .select("r.id")
          .where((w) => w.or([w("g.state", "!=", "pending"), w("n.state", "=", "cancelled")]))
          .where("r.ended_at", "is", null),
      ).map((r) => r.id);
    },
    /** One run step by step, with previews short enough for a screen. */
    detail(flow: string, event: string): FlowRunDetail | undefined {
      const head = one(
        qb
          .selectFrom("flow_graph_events as g")
          .innerJoin("flow_graph_revisions as r", (j) =>
            j.onRef("r.flow_id", "=", "g.flow_id").onRef("r.revision", "=", "g.revision"),
          )
          .innerJoin("flow_events as e", (j) =>
            j.onRef("e.flow_id", "=", "g.flow_id").onRef("e.event_id", "=", "g.event_id"),
          )
          .leftJoin("flow_graph_drafts as d", "d.flow_id", "g.flow_id")
          .select([
            "g.revision",
            "g.state",
            "g.deadline_at",
            "g.ended_at",
            "r.graph",
            "e.created_at",
            "d.published_revision",
          ])
          .where("g.flow_id", "=", flow)
          .where("g.event_id", "=", event),
      );
      if (!head) return undefined;
      const graph = FlowGraph.parse(JSON.parse(head.graph));
      const rows = new Map(
        all(
          qb
            .selectFrom("flow_graph_nodes")
            .selectAll()
            .where("flow_id", "=", flow)
            .where("event_id", "=", event)
            .where("revision", "=", head.revision),
        ).map((r) => [r.node_id, r]),
      );
      const steps: FlowStepRecord[] = graph.nodes.flatMap((n: FlowNode) => {
        const r = rows.get(n.id);
        if (!r) return [];
        const input = preview(r.input);
        const output = preview(r.output);
        return [
          {
            node: n.id,
            state: r.state as FlowStepRecord["state"],
            started_at: r.started_at,
            ended_at: r.ended_at,
            input: input.text,
            output: output.text,
            truncated: input.cut || output.cut,
            error: r.error,
            run_id: r.run_id,
            thread_id: r.thread_id,
          },
        ];
      });
      return {
        flow,
        event,
        revision: head.revision,
        current: head.revision === head.published_revision,
        graph,
        state: head.state as FlowRunState,
        created_at: head.created_at,
        ended_at: head.ended_at,
        deadline_at: head.deadline_at,
        steps,
      };
    },
  };
  return api;
}
