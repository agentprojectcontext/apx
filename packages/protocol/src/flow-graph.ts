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
     * model_uncertain, not_started, run_failed, run_canceled, run_silent, deadline, value_too_large.
     */
    error: z.string().nullable(),
    run_id: z.string().nullable(),
    thread_id: z.string().nullable(),
  })
  .strict();
export type FlowStepRecord = z.infer<typeof FlowStepRecord>;
export const FlowRunState = z.enum(["pending", "succeeded", "failed", "uncertain", "cancelled", "ignored"]);
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
  "flows.validate": {
    params: z.object({ flow: FlowId, graph: FlowGraph }).strict(),
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
  "flows.publish": {
    params: z
      .object({
        flow: FlowId,
        expectedDraftVersion: z.number().int().min(1),
        expectedPublishedRevision: z.number().int().min(1).nullable(),
      })
      .strict(),
    result: FlowGraphDocument,
    effect: true,
    access: "human",
  },
} as const;
