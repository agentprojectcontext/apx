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
/** A model as `engine/model#effort` (domain.ts ModelRef): the engine is the harness that runs it. */
const FlowModelRef = z
  .string()
  .regex(/^(acp:)?[a-z0-9][a-z0-9._-]*(\/[^#]+)?(#[a-z0-9-]+)?$/i)
  .max(200);
const Base = { id: FlowNodeId, label: z.string().min(1).max(120) };
const Key = z.string().min(1).max(128);
/** A table of the Flow's project, by name: lowercase letters, digits, `_` and `-` (DECISIONS.md#d-173). */
export const FlowTableName = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
/**
 * A column of a project's table, read by later steps as `$steps.<read>.<column>` (DECISIONS.md#d-176): letters,
 * digits, `_` and `-`; `rows` and `row` are what a read returns besides its columns.
 */
export const FlowColumnName = z
  .string()
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/)
  .refine((value) => !["rows", "row", "__proto__", "constructor", "prototype"].includes(value), "a reserved name");
/** At most this many columns in a table. */
export const FLOW_TABLE_COLUMNS = 50;
/** A way out of a check: a case's id, or "no" for "otherwise" (a yes/no check is the two-case default). */
export const FlowBranchId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
/** A name later steps read as `$vars.name`, or a SQL parameter's `:name`. */
export const FlowVarName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value));
/** A small expression over `$trigger`, `$steps.<step>` and `$vars.<name>` (domain/flow-expr.ts): never code. */
const FlowExpr = z.string().min(1).max(1000);
const FlowCase = z
  .object({
    id: FlowBranchId,
    label: z.string().max(60),
    /** `equals`: the check's input is this value; `expr`: the expression comes out true. */
    match: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("equals"), value: JsonLiteral }).strict(),
      z.object({ kind: z.literal("expr"), expr: FlowExpr }).strict(),
    ]),
  })
  .strict();
export const FlowNode = z.discriminatedUnion("kind", [
  z.object({ ...Base, kind: z.literal("webhook") }).strict(),
  /** Five-field cron in the owner's time zone; presets are crons too. */
  z.object({ ...Base, kind: z.literal("schedule"), cron: z.string().min(9).max(120) }).strict(),
  /**
   * A switch: the first case that holds picks the way out, else "no" (otherwise). Without `cases` it is the yes/no
   * check drawings had before: one case "yes", `input` equals `equals`.
   */
  z
    .object({
      ...Base,
      kind: z.literal("condition"),
      input: FlowBinding,
      equals: JsonLiteral.optional(),
      cases: z.array(FlowCase).min(1).max(15).optional(),
    })
    .strict(),
  /** Named values set once per run, constants or expressions; later steps read them as `$vars.name`. */
  z
    .object({
      ...Base,
      kind: z.literal("vars"),
      vars: z
        .array(
          z
            .object({
              name: FlowVarName,
              value: z.discriminatedUnion("kind", [
                z.object({ kind: z.literal("literal"), value: JsonLiteral }).strict(),
                z.object({ kind: z.literal("expr"), expr: FlowExpr }).strict(),
              ]),
            })
            .strict(),
        )
        .min(1)
        .max(16),
    })
    .strict(),
  /** A JavaScript function body of `input` and `vars` that returns JSON, run apart with no files or network. */
  z
    .object({
      ...Base,
      kind: z.literal("js"),
      code: z.string().min(1).max(8000),
      input: FlowBinding,
      timeoutMs: z.number().int().min(100).max(10000),
    })
    .strict(),
  /**
   * One statement on a SQLite file inside the Flow's project. Values reach it only as bound `:name` parameters
   * (templates); a read caps its rows, a write is a side effect the owner allowed by publishing.
   */
  z
    .object({
      ...Base,
      kind: z.literal("sql"),
      database: z.string().min(1).max(500),
      mode: z.enum(["read", "write"]),
      query: z.string().min(1).max(8000),
      params: z.array(z.object({ name: FlowVarName, value: z.string().max(2000) }).strict()).max(32),
      maxRows: z.number().int().min(1).max(500),
      timeoutMs: z.number().int().min(1000).max(30000),
    })
    .strict(),
  /**
   * A shell command in the Flow's project folder, fixed in the revision. Values reach it only through environment
   * variables and its standard input (templates), never inside the command text.
   */
  z
    .object({
      ...Base,
      kind: z.literal("cmd"),
      command: z.string().min(1).max(4000),
      env: z
        .array(
          z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), value: z.string().max(4000) }).strict(),
        )
        .max(16),
      stdin: z.string().max(16000),
      timeoutMs: z.number().int().min(1000).max(120000),
      /** On, a command that exits with an error still succeeds, so a check can read its exit code. */
      continueOnError: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...Base,
      kind: z.literal("table_read"),
      /** A table of the project; absent, the Flow's own table (a definition drawn as a graph). */
      table: FlowTableName.optional(),
      /** Keys to read, each may hold placeholders; empty when it reads the `latest` rows. */
      keys: z.array(Key).max(16),
      latest: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      ...Base,
      kind: z.literal("table_write"),
      table: FlowTableName.optional(),
      /** The row's key; may hold placeholders (`$trigger.email`), filled when the step runs. */
      key: Key,
      /** What it saves as a whole; a save with `columns` has none. */
      value: FlowBinding.optional(),
      /**
       * A value for each column, a template each: one placeholder alone saves that value as it is, anything else as
       * text. Saving again under the key changes only these columns (DECISIONS.md#d-176).
       */
      columns: z
        .array(z.object({ name: FlowColumnName, value: z.string().max(8000) }).strict())
        .max(FLOW_TABLE_COLUMNS)
        .optional(),
    })
    .strict(),
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
  /**
   * An AI model step: one of the owner's agents (its instructions, memory and tools), or a bot of this Flow alone
   * (`bot`: a name and a system prompt, no memory or history). `model` picks the harness, model and effort in one ref;
   * absent, the agent's own choice. `autonomy` (APX's harness) or `write` (a CLI's) is how freely it acts; `delegate`
   * lets it hand work to or message other agents, off unless set (DECISIONS.md#d-172).
   */
  z
    .object({
      ...Base,
      kind: z.literal("agent"),
      agent: FlowId.optional(),
      bot: z
        .object({ name: z.string().min(1).max(60), system: z.string().min(1).max(8000) })
        .strict()
        .optional(),
      model: FlowModelRef.optional(),
      autonomy: z.enum(["manual", "auto", "total"]).optional(),
      write: z.enum(["ask", "auto", "read-only"]).optional(),
      delegate: z.boolean().optional(),
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
    /** `when` picks a check's way out: a case's id ("yes", the default, is the first) or "no" for otherwise. */
    edges: z
      .array(z.object({ source: FlowNodeId, target: FlowNodeId, when: FlowBranchId.optional() }).strict())
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
    /** The agent whose tool saved the draft, null for the owner: turning the Flow on opens it for review first. */
    draftBy: z.string().nullable().default(null),
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
     * send_uncertain; http: destination_refused, request_failed, request_uncertain, value_invalid, secret_missing;
     * js: code_failed, code_timeout, code_too_large, code_stopped; sql: database_unavailable, query_failed,
     * query_timeout, write_uncertain, write_limited; cmd: folder_unavailable, command_failed, command_timeout,
     * command_uncertain, command_limited. A failed step may
     * keep in `output` what it said (an error message, a command's output).
     */
    error: z.string().nullable(),
    run_id: z.string().nullable(),
    thread_id: z.string().nullable(),
    /** The harness and model that answered the run the step handed work to, once it started. */
    answered: z.object({ harness: z.string(), model: z.string().nullable() }).strict().optional(),
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

/**
 * Reading a drawing, checking it and saving a draft are open to an agent's own tool for Flows of its project (a global
 * agent's: any), never to an outside app, a channel or an agent's shell: a draft runs nothing until the owner publishes
 * it (DECISIONS.md#d-174). Publishing, discarding, running and stopping stay the owner's.
 */
export const flowGraphMethods = {
  "flows.graph_get": {
    params: z.object({ flow: FlowId }).strict(),
    result: FlowGraphDocument,
    effect: false,
  },
  "flows.draft_save": {
    params: z
      .object({
        flow: FlowId,
        expectedVersion: z.number().int().min(1).nullable(),
        graph: FlowGraph,
        /**
         * The owner's edits saved over an agent's draft they have not saved from the editor yet (its chat saves them
         * before each message): the draft keeps that agent as who drew it, so it still waits for the owner's review.
         */
        unreviewed: z.literal(true).optional(),
      })
      .strict(),
    result: FlowGraphDocument,
    effect: true,
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
              /** A check that ran: the way out it took (a case's id, or "no"). */
              branch: z.string().nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
    effect: false,
    access: "human",
  },
  /**
   * Where a drawing would send as the owner, which hosts it would call, the commands it would run and the databases it
   * would change, in words to show before publishing.
   */
  "flows.outward": {
    params: z.object({ flow: FlowId, graph: FlowGraph }).strict(),
    result: z
      .object({
        /** Keys to pass back to `flows.publish` once the owner has seen them. */
        keys: z.array(z.string()),
        /** `owner`: it goes to the owner themselves; `type` is the channel's kind, for its icon. */
        sends: z.array(
          z
            .object({ node: FlowNodeId, channel: z.string(), type: z.string(), to: z.string(), owner: z.boolean() })
            .strict(),
        ),
        /** `secrets`: the names of the secrets it sends to that address. */
        calls: z.array(
          z.object({ node: FlowNodeId, method: z.string(), host: z.string(), secrets: z.array(z.string()) }).strict(),
        ),
        /** Commands it runs on this computer, in the project's folder; `secrets`: those in its environment. */
        commands: z.array(
          z
            .object({ node: FlowNodeId, command: z.string(), folder: z.string(), secrets: z.array(z.string()) })
            .strict(),
        ),
        /** Database files it changes. */
        writes: z.array(z.object({ node: FlowNodeId, database: z.string() }).strict()),
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
         * them before it runs. Required, and must match, when the draft has notify, http, cmd or SQL write steps.
         */
        outward: z.array(z.string().max(2400)).max(160).optional(),
      })
      .strict(),
    result: FlowGraphDocument,
    effect: true,
    access: "human",
  },
} as const;
