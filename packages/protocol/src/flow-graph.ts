import { z } from "zod";

const FlowId = z.string().min(1).max(100);
export const FlowNodeId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const Segment = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value));
export const FlowPath = z.array(Segment).max(16);
const JsonLiteral = z.union([z.string().max(8000), z.number().finite(), z.boolean(), z.null()]);
export const FlowBinding = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: JsonLiteral }).strict(),
  z.object({ kind: z.literal("event"), path: FlowPath }).strict(),
  z.object({ kind: z.literal("node"), node: FlowNodeId, path: FlowPath }).strict(),
]);
export type FlowBinding = z.infer<typeof FlowBinding>;
const Base = { id: FlowNodeId, label: z.string().min(1).max(120) };
const Key = z.string().min(1).max(128);
export const FlowNode = z.discriminatedUnion("kind", [
  z.object({ ...Base, kind: z.literal("webhook") }).strict(),
  /** Five-field cron in the owner's time zone; presets are crons too. */
  z.object({ ...Base, kind: z.literal("schedule"), cron: z.string().min(9).max(120) }).strict(),
  z.object({ ...Base, kind: z.literal("condition"), input: FlowBinding, equals: JsonLiteral }).strict(),
  z.object({ ...Base, kind: z.literal("table_read"), keys: z.array(Key).min(1).max(16) }).strict(),
  z.object({ ...Base, kind: z.literal("table_write"), key: Key, value: FlowBinding }).strict(),
  z
    .object({
      ...Base,
      kind: z.literal("llm"),
      model: z.string().min(1).max(200),
      prompt: z.string().min(1).max(8000),
      input: FlowBinding,
      maxOutputTokens: z.number().int().min(1).max(2048),
      timeoutMs: z.number().int().min(1000).max(120000),
    })
    .strict(),
  z
    .object({
      ...Base,
      kind: z.literal("agent"),
      agent: FlowId,
      prompt: z.string().min(1).max(8000),
      input: FlowBinding,
    })
    .strict(),
  z.object({ ...Base, kind: z.literal("routine"), routine: FlowId, input: FlowBinding }).strict(),
  /**
   * Sends `text` (a template) as the owner to a contact or room the owner picked; the destination is fixed in the
   * revision, never taken from the payload. `onlyIfContent` skips the send when every placeholder came out empty.
   */
  z
    .object({
      ...Base,
      kind: z.literal("notify"),
      channel: FlowId,
      to: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("contact"), person: FlowId }).strict(),
        z.object({ kind: z.literal("room"), room: z.string().min(1).max(200) }).strict(),
      ]),
      text: z.string().min(1).max(4000),
      onlyIfContent: z.boolean(),
    })
    .strict(),
  /** Calls a URL fixed in the revision; header values and body are templates, secrets only as `secret://name`. */
  z
    .object({
      ...Base,
      kind: z.literal("http"),
      method: z.enum(["GET", "POST", "PUT"]),
      url: z.string().min(8).max(2000),
      headers: z
        .array(
          z
            .object({ name: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/), value: z.string().max(4000) })
            .strict(),
        )
        .max(16),
      body: z.string().max(16000),
      timeoutMs: z.number().int().min(1000).max(30000),
    })
    .strict(),
]);
export type FlowNode = z.infer<typeof FlowNode>;
export const FlowGraph = z
  .object({
    schemaVersion: z.literal(2),
    nodes: z.array(FlowNode).min(1).max(32),
    /** `when` picks a check's branch: "yes" (the default) runs when it matched, "no" when it did not. */
    edges: z
      .array(z.object({ source: FlowNodeId, target: FlowNodeId, when: z.enum(["yes", "no"]).optional() }).strict())
      .max(64),
    layout: z
      .array(
        z
          .object({
            node: FlowNodeId,
            x: z.number().finite().min(-100000).max(100000),
            y: z.number().finite().min(-100000).max(100000),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();
export type FlowGraph = z.infer<typeof FlowGraph>;
export const FlowGraphIssue = z.object({ code: z.string(), node: FlowNodeId.optional(), message: z.string() }).strict();
export type FlowGraphIssue = z.infer<typeof FlowGraphIssue>;
export const FlowGraphDocument = z
  .object({
    flow: FlowId,
    draftVersion: z.number().int().min(1).nullable(),
    draft: FlowGraph.nullable(),
    publishedRevision: z.number().int().min(1).nullable(),
    published: FlowGraph.nullable(),
    /** Published graphs run: new events use `publishedRevision`, events already admitted keep theirs. */
    executionAvailable: z.boolean(),
  })
  .strict();

/** How a step of a graph run ended, or where it stands. */
export const FlowStepState = z.enum([
  "pending",
  "running",
  "waiting_run",
  "succeeded",
  "skipped",
  "blocked",
  "failed",
  "uncertain",
  "cancelled",
]);
/** One step of one run: what it was given and gave back (capped previews), when, and the run it handed work to. */
export const FlowStepRecord = z
  .object({
    node: FlowNodeId,
    state: FlowStepState,
    started_at: z.string().nullable(),
    ended_at: z.string().nullable(),
    /** JSON text, at most 4,000 characters; `truncated` says a longer value was cut for display. */
    input: z.string().nullable(),
    output: z.string().nullable(),
    truncated: z.boolean(),
    /**
     * Why it did not succeed, as a code: missing_value, table_full, model_unavailable, model_refused, model_cut,
     * model_uncertain, not_started, run_failed, run_canceled, run_silent, deadline, value_too_large, owner_cancelled,
     * cancelled_after_send; notify: nothing_to_tell (skipped), rate_limited, destination_unavailable, send_failed,
     * send_uncertain; http: destination_refused, request_failed, request_uncertain, value_invalid, secret_missing.
     */
    error: z.string().nullable(),
    run_id: z.string().nullable(),
    thread_id: z.string().nullable(),
  })
  .strict();
export type FlowStepRecord = z.infer<typeof FlowStepRecord>;
export const FlowRunState = z.enum(["pending", "succeeded", "failed", "uncertain", "cancelled", "ignored"]);
/** What started a run: a POST, its schedule, or the owner's "Run now". */
export const FlowRunSource = z.enum(["webhook", "schedule", "owner"]);
export const FlowRunDetail = z
  .object({
    flow: FlowId,
    event: z.string(),
    revision: z.number().int().min(1),
    /** The revision is the one published now; false draws a previous version. */
    current: z.boolean(),
    graph: FlowGraph,
    state: FlowRunState,
    created_at: z.string(),
    ended_at: z.string().nullable(),
    deadline_at: z.string(),
    source: FlowRunSource,
    /** A scheduled run: the time it was due (it can start later, once, when the core was off then). */
    scheduled_at: z.string().nullable(),
    steps: z.array(FlowStepRecord),
  })
  .strict();
export type FlowRunDetail = z.infer<typeof FlowRunDetail>;

export const flowGraphMethods = {
  "flows.graph_get": {
    params: z.object({ flow: FlowId }).strict(),
    result: FlowGraphDocument,
    effect: false,
    access: "human",
  },
  "flows.draft_save": {
    params: z.object({ flow: FlowId, expectedVersion: z.number().int().min(1).nullable(), graph: FlowGraph }).strict(),
    result: FlowGraphDocument,
    effect: true,
    access: "human",
  },
  "flows.draft_discard": {
    params: z.object({ flow: FlowId, expectedVersion: z.number().int().min(1), confirm: z.literal(true) }).strict(),
    result: FlowGraphDocument,
    effect: true,
    access: "human",
  },
  /** A new Flow, not saved yet, is checked against the project it will belong to. */
  "flows.validate": {
    params: z
      .object({ flow: FlowId.optional(), project: FlowId.optional(), graph: FlowGraph })
      .strict()
      .refine((p) => (p.flow === undefined) !== (p.project === undefined), "Pass a flow or a project"),
    result: z.object({ valid: z.boolean(), issues: z.array(FlowGraphIssue) }).strict(),
    effect: false,
    access: "human",
  },
  /** One graph run step by step; legacy events have no steps (use `flows.events`). */
  "flows.run_get": {
    params: z.object({ flow: FlowId, event: z.string().min(1).max(256) }).strict(),
    result: FlowRunDetail,
    effect: false,
    access: "human",
  },
  /** When a cron fires next in the owner's time zone; `error` says why it can't be used. */
  "flows.next_runs": {
    params: z.object({ cron: z.string().min(1).max(120) }).strict(),
    result: z
      .object({
        next: z.array(z.string()).max(3),
        time_zone: z.string(),
        error: z.enum(["invalid", "too_often"]).nullable(),
      })
      .strict(),
    effect: false,
    access: "human",
  },
  /**
   * Starts a published, enabled Flow now through the same admission as its trigger: a schedule Flow with an empty
   * event, a webhook Flow with the sample body given (untrusted, like any payload).
   */
  "flows.run_now": {
    params: z.object({ flow: FlowId, data: z.unknown().optional() }).strict(),
    result: z.object({ event: z.string(), state: z.enum(["pending", "ignored", "duplicate"]) }).strict(),
    effect: true,
    access: "human",
  },
  /** Stops a run that is going: pending steps are cancelled, a model call already sent is left to look at. */
  "flows.cancel_run": {
    params: z.object({ flow: FlowId, event: z.string().min(1).max(256) }).strict(),
    result: z.object({ cancelled: z.boolean(), state: FlowRunState.nullable() }).strict(),
    effect: true,
    access: "human",
  },
  /**
   * What a drawing would do with this data: checks and bindings as a run evaluates them. Reads no table, saves
   * nothing, calls no model and starts no run; steps that do work say they would run.
   */
  "flows.try_graph": {
    params: z.object({ graph: FlowGraph, data: z.unknown() }).strict(),
    result: z
      .object({
        steps: z.array(
          z
            .object({
              node: FlowNodeId,
              state: z.enum(["ran", "would_run", "skipped", "unknown", "missing"]),
              matched: z.boolean().nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
    effect: false,
    access: "human",
  },
  /** Where a drawing would send as the owner and which hosts it would call, in words to show before publishing. */
  "flows.outward": {
    params: z.object({ flow: FlowId, graph: FlowGraph }).strict(),
    result: z
      .object({
        /** Keys to pass back to `flows.publish` once the owner has seen them. */
        keys: z.array(z.string()),
        sends: z.array(z.object({ node: FlowNodeId, channel: z.string(), to: z.string() }).strict()),
        calls: z.array(z.object({ node: FlowNodeId, method: z.string(), host: z.string() }).strict()),
      })
      .strict(),
    effect: false,
    access: "human",
  },
  "flows.publish": {
    params: z
      .object({
        flow: FlowId,
        expectedDraftVersion: z.number().int().min(1),
        expectedPublishedRevision: z.number().int().min(1).nullable(),
        /**
         * Where the drawing sends and which hosts it calls, as `flows.outward` lists them for this draft: the owner saw
         * them before it runs. Required, and must match, when the draft has notify or http steps.
         */
        outward: z.array(z.string().max(400)).max(16).optional(),
      })
      .strict(),
    result: FlowGraphDocument,
    effect: true,
    access: "human",
  },
} as const;
