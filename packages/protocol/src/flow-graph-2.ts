import { z } from "zod";
import {
  cmdStep,
  conditionStep,
  DRAFT,
  type Fill,
  FlowBinding,
  FlowBranchId,
  FlowId,
  FlowModelRef,
  FlowNodeId,
  jsStep,
  llmStep,
  STRICT,
  type StepContext,
  scheduleStep,
  sqlStep,
  stepContext,
  tableReadStep,
  tableWriteStep,
  varsStep,
  webhookStep,
} from "./flow-graph-1.ts";
import { schemaFields } from "./schema-fields.ts";

function agentStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("agent"),
        agent: () => fill.name(FlowId).optional(),
        bot: () =>
          z
            .object(
              schemaFields({
                name: () => fill.text(60),
                system: () => fill.text(8000),
              }),
            )
            .strict()
            .optional(),
        model: () => FlowModelRef.optional(),
        autonomy: () => z.enum(["manual", "auto", "total"]).optional(),
        write: () => z.enum(["ask", "auto", "read-only"]).optional(),
        delegate: () => z.boolean().optional(),
        prompt: () => fill.text(8000),
        input: () => FlowBinding,
      }),
    )
    .strict();
}

function routineStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("routine"),
        routine: () => fill.name(FlowId),
        input: () => FlowBinding,
      }),
    )
    .strict();
}

function notifyStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("notify"),
        channel: () => fill.name(FlowId),
        to: () =>
          z.discriminatedUnion("kind", [
            z
              .object(
                schemaFields({
                  kind: () => z.literal("contact"),
                  person: () => fill.name(FlowId),
                }),
              )
              .strict(),
            z
              .object(
                schemaFields({
                  kind: () => z.literal("room"),
                  room: () => fill.text(200),
                }),
              )
              .strict(),
          ]),
        text: () => fill.text(4000),
        onlyIfContent: () => z.boolean(),
      }),
    )
    .strict();
}

function httpStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("http"),
        method: () => z.enum(["GET", "POST", "PUT"]),
        url: () => fill.text(2000, 8),
        headers: () =>
          z
            .array(
              z
                .object(
                  schemaFields({
                    name: () => fill.name(z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/)),
                    value: () => z.string().max(4000),
                  }),
                )
                .strict(),
            )
            .max(16),
        body: () => z.string().max(16000),
        timeoutMs: () => z.number().int().min(1000).max(30000),
      }),
    )
    .strict();
}

function stepSchema(fill: Fill) {
  const context = stepContext(fill);
  return z.discriminatedUnion("kind", [
    webhookStep(context),
    scheduleStep(context),
    conditionStep(context),
    varsStep(context),
    jsStep(context),
    sqlStep(context),
    cmdStep(context),
    tableReadStep(context),
    tableWriteStep(context),
    llmStep(context),
    agentStep(context),
    routineStep(context),
    notifyStep(context),
    httpStep(context),
  ]);
}
export const FlowNode = stepSchema(STRICT);
/** A step as a draft keeps it: settings it needs to run may still be empty (`flowStepGap` names the first). */
export const FlowDraftNode = stepSchema(DRAFT);
export type FlowNode = z.infer<typeof FlowNode>;
const graphSchema = (node: typeof FlowNode | typeof FlowDraftNode) =>
  z
    .object(
      schemaFields({
        schemaVersion: () => z.literal(2),
        nodes: () => z.array(node).min(1).max(32),
        /** `when` picks a check's way out: a case's id ("yes", the default, is the first) or "no" for otherwise. */
        edges: () =>
          z
            .array(
              z
                .object(
                  schemaFields({
                    source: () => FlowNodeId,
                    target: () => FlowNodeId,
                    when: () => FlowBranchId.optional(),
                  }),
                )
                .strict(),
            )
            .max(64),
        layout: () =>
          z
            .array(
              z
                .object(
                  schemaFields({
                    node: () => FlowNodeId,
                    x: () => z.number().finite().min(-100000).max(100000),
                    y: () => z.number().finite().min(-100000).max(100000),
                  }),
                )
                .strict(),
            )
            .max(32),
      }),
    )
    .strict();
/** A drawing that runs: what publishing, a run, a try and the executor read. */
export const FlowGraph = graphSchema(FlowNode);
/** A drawing as a draft keeps it: the same steps and connections, settings possibly still empty. */
export const FlowDraftGraph = graphSchema(FlowDraftNode);
export type FlowGraph = z.infer<typeof FlowGraph>;
export type FlowDraftGraph = z.infer<typeof FlowDraftGraph>;
export type FlowDraftNode = z.infer<typeof FlowDraftNode>;
export const FlowGraphIssue = z
  .object(
    schemaFields({
      code: () => z.string(),
      node: () => FlowNodeId.optional(),
      message: () => z.string(),
    }),
  )
  .strict();
export type FlowGraphIssue = z.infer<typeof FlowGraphIssue>;
export const FlowGraphDocument = z
  .object(
    schemaFields({
      flow: () => FlowId,
      draftVersion: () => z.number().int().min(1).nullable(),
      /** May hold steps with settings still empty; `published` never does. */
      draft: () => FlowDraftGraph.nullable(),
      /** The agent whose tool saved the draft, null for the owner: turning the Flow on opens it for review first. */
      draftBy: () => z.string().nullable().default(null),
      publishedRevision: () => z.number().int().min(1).nullable(),
      published: () => FlowGraph.nullable(),
      /** Published graphs run: new events use `publishedRevision`, events already admitted keep theirs. */
      executionAvailable: () => z.boolean(),
    }),
  )
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
  .object(
    schemaFields({
      node: () => FlowNodeId,
      state: () => FlowStepState,
      started_at: () => z.string().nullable(),
      ended_at: () => z.string().nullable(),
      /** JSON text, at most 4,000 characters; `truncated` says a longer value was cut for display. */
      input: () => z.string().nullable(),
      output: () => z.string().nullable(),
      truncated: () => z.boolean(),
      /**
       * Why it did not succeed, as a code: missing_value, table_full, table_missing, required_empty (a save left a
       * required column empty; `output.required` names them), model_unavailable, model_refused, model_cut,
       * model_uncertain, not_started, run_failed, run_canceled, run_silent, deadline, value_too_large, owner_cancelled,
       * cancelled_after_send; notify: nothing_to_tell (skipped), rate_limited, destination_unavailable, send_failed,
       * send_uncertain; http: destination_refused, request_failed, request_uncertain, value_invalid, secret_missing;
       * js: code_failed, code_timeout, code_too_large, code_stopped; sql: database_unavailable, query_failed,
       * query_timeout, write_uncertain, write_limited; cmd: folder_unavailable, command_failed, command_timeout,
       * command_uncertain, command_limited. A failed step may
       * keep in `output` what it said (an error message, a command's output).
       */
      error: () => z.string().nullable(),
      run_id: () => z.string().nullable(),
      thread_id: () => z.string().nullable(),
      /** The harness and model that answered the run the step handed work to, once it started. */
      answered: () =>
        z
          .object(
            schemaFields({
              harness: () => z.string(),
              model: () => z.string().nullable(),
            }),
          )
          .strict()
          .optional(),
    }),
  )
  .strict();
export type FlowStepRecord = z.infer<typeof FlowStepRecord>;
export const FlowRunState = z.enum(["pending", "succeeded", "failed", "uncertain", "cancelled", "ignored"]);
/** What started a run: a POST, its schedule, or the owner's "Run now". */
export const FlowRunSource = z.enum(["webhook", "schedule", "owner"]);
export const FlowRunDetail = z
  .object(
    schemaFields({
      flow: () => FlowId,
      event: () => z.string(),
      revision: () => z.number().int().min(1),
      /** The revision is the one published now; false draws a previous version. */
      current: () => z.boolean(),
      graph: () => FlowGraph,
      state: () => FlowRunState,
      created_at: () => z.string(),
      ended_at: () => z.string().nullable(),
      deadline_at: () => z.string(),
      source: () => FlowRunSource,
      /** A scheduled run: the time it was due (it can start later, once, when the core was off then). */
      scheduled_at: () => z.string().nullable(),
      /** A test from the editor: it ran the saved drawing, and the Flow need not be on (DECISIONS.md#d-178). */
      test: () => z.boolean(),
      /**
       * What arrived, for a run a POST started: a few of its headers (never a key) and its data as stored (redacted,
       * at most 4,000 characters; `truncated` says it was cut). Null for a schedule's or the owner's run.
       */
      arrived: () =>
        z
          .object(
            schemaFields({
              headers: () => z.record(z.string(), z.string()),
              body: () => z.string(),
              truncated: () => z.boolean(),
            }),
          )
          .strict()
          .nullable(),
      steps: () => z.array(FlowStepRecord),
    }),
  )
  .strict();
export type FlowRunDetail = z.infer<typeof FlowRunDetail>;
