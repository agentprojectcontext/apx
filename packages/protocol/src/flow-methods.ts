import { z } from "zod";
import { FlowDraftGraph, FlowGraphDocument, flowGraphMethods } from "./flow-graph.ts";
import { flowHistoryMethods } from "./flow-history.ts";
import { FLOW_PATH, FLOW_PATH_SAVED } from "./flow-path.ts";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const FlowToken = z.object({ token: z.string().nullable(), rotated_at: z.string().nullable() }).strict();
const Scalar = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
export const FlowAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("agent"), agent: Id, prompt: z.string().min(1).max(8000) }).strict(),
  z.object({ kind: z.literal("routine"), routine: Id }).strict(),
]);
const FlowPredicates = z
  .array(z.object({ path: z.array(z.string().min(1).max(128)).min(1).max(16), equals: Scalar }).strict())
  .max(32);
export const FlowDefinition = z
  .object({
    id: Id,
    projectId: Id,
    name: z.string().min(1).max(120),
    enabled: z.boolean(),
    predicates: FlowPredicates,
    tableKey: z.string().min(1).max(128),
    readKeys: z.array(z.string().min(1).max(128)).max(16).optional(),
    action: FlowAction,
    /**
     * Its public address, `/flows/<path>`: unique among the owner's Flows, from its name when made; a Flow from before
     * paths keeps its identifier. Left out of `flows.set`, it stays as it is (DECISIONS.md#d-178).
     */
    path: z.string().regex(FLOW_PATH_SAVED).optional(),
  })
  .strict();
export type FlowDefinition = z.infer<typeof FlowDefinition>;
export const FlowEvent = z.object({
  flow_id: Id,
  event_id: z.string(),
  /** Legacy: ignored, written, pending, admitted, failed. Graph: pending until it ends, then how it ended. */
  state: z.enum(["ignored", "written", "pending", "admitted", "failed", "succeeded", "uncertain", "cancelled"]),
  created_at: z.string(),
  run_id: z.string().nullable(),
  run_state: z.string().nullable(),
  error: z.string().nullable(),
  /** When the admitted run started and ended, and the fresh tokens it spent; null until it has them. */
  run_started_at: z.string().nullable().default(null),
  run_ended_at: z.string().nullable().default(null),
  run_tokens: z.number().int().nullable().default(null),
  /** Which executor admitted it; a graph run's steps come from `flows.run_get`. */
  executor: z.enum(["legacy", "graph"]).default("legacy"),
  /** The graph revision it runs, and whether that is still the published one (false: a previous version). */
  revision: z.number().int().nullable().default(null),
  current: z.boolean().default(true),
  /** Legacy: the index of the first check the data did not pass, when that is what stopped it. */
  stopped_at: z.number().int().nullable().default(null),
  /** Graph: the check that said no when nothing after it did any work (a run cut short), else null. */
  stopped_by: z.string().nullable().default(null),
  /** When a graph run ended. */
  ended_at: z.string().nullable().default(null),
  /** What started it: a POST, its schedule or the owner's "Run now". */
  source: z.enum(["webhook", "schedule", "owner"]).default("webhook"),
  /** A scheduled run: the time it was due; later than `created_at` by more than a minute means it ran late, once. */
  scheduled_at: z.string().nullable().default(null),
  /** The owner stopped it ("Cancel run"); it ended cancelled, or uncertain when a step had been sent. */
  cancelled_by_owner: z.boolean().default(false),
  /** A test the owner started from the editor: it ran the saved drawing, not what runs (DECISIONS.md#d-178). */
  test: z.boolean().default(false),
});
export const FlowEventCursor = z
  .object({ createdAt: z.string().datetime(), eventId: z.string().min(1).max(256) })
  .strict();
export type FlowEventCursor = z.infer<typeof FlowEventCursor>;
export const flowMethods = {
  ...flowGraphMethods,
  ...flowHistoryMethods,
  "flows.list": {
    params: z.object({ project: Id.optional() }).strict(),
    /**
     * `published`: for each Flow that runs a drawing, its revision and step kinds in the order they run.
     * `schedules`: for each that runs on a schedule, its cron and next time (null while off), and how many times
     * were skipped since it was turned on because its last run was still going; `time_zone` is the owner's, the one
     * crons run in.
     */
    result: z.object({
      flows: z.array(FlowDefinition),
      published: z.record(z.string(), z.object({ revision: z.number().int(), kinds: z.array(z.string()) })).default({}),
      /**
       * For each Flow with a saved draft that is not what runs: its version and step kinds in the order they would
       * run. The list shows these, marked as a draft, instead of what runs.
       */
      drafts: z.record(z.string(), z.object({ version: z.number().int(), kinds: z.array(z.string()) })).default({}),
      schedules: z
        .record(
          z.string(),
          z.object({
            cron: z.string(),
            next_at: z.string().nullable(),
            skipped: z.number().int().default(0),
            skipped_at: z.string().nullable().default(null),
          }),
        )
        .default({}),
      time_zone: z.string().default("UTC"),
    }),
    effect: false,
    access: "human",
  },
  "flows.set": { params: FlowDefinition, result: FlowDefinition, effect: true, access: "human" },
  /**
   * A new Flow in a project, off, with this drawing as its draft: what an agent's tool makes when asked for a Flow
   * (DECISIONS.md#d-174). Its identifier comes from the name; turning it on and publishing stay the owner's.
   */
  "flows.create": {
    params: z
      .object({
        project: Id,
        name: z.string().trim().min(1).max(120),
        graph: FlowDraftGraph,
        /** The address the owner chose before saving; else one from the name. */
        path: z.string().regex(FLOW_PATH).optional(),
      })
      .strict(),
    result: z.object({ flow: FlowDefinition, document: FlowGraphDocument }).strict(),
    effect: true,
  },
  /**
   * Whether a Flow can take this address: `taken` by another Flow, `invalid` or `reserved` as written; `free` is the
   * first free one from it (itself when it is free). `flow`: the Flow asking, whose own address is free to it.
   */
  "flows.path_check": {
    params: z.object({ path: z.string().max(200), flow: Id.optional() }).strict(),
    result: z
      .object({ ok: z.boolean(), problem: z.enum(["taken", "invalid", "reserved"]).nullable(), free: z.string() })
      .strict(),
    effect: false,
    access: "human",
  },
  /** A new address for a Flow: the old one stops answering at once; its key, if it had one, moves with it. */
  "flows.path_set": {
    params: z.object({ flow: Id, path: z.string().regex(FLOW_PATH) }).strict(),
    result: FlowDefinition,
    effect: true,
    access: "human",
  },
  /** The key a webhook Flow's callers send as `Authorization: Bearer <key>`; null before it has one. */
  "flows.token": {
    params: z.object({ flow: Id }).strict(),
    result: FlowToken,
    effect: false,
    access: "human",
  },
  /**
   * A new key for a webhook Flow's address, made by APX or the owner's own (`token`, 24 to 200 letters, digits, `.`,
   * `_`, `~` or `-`); the old one stops working at once.
   */
  "flows.token_rotate": {
    params: z
      .object({
        flow: Id,
        token: z
          .string()
          .regex(/^[A-Za-z0-9._~-]{24,200}$/)
          .optional(),
      })
      .strict(),
    result: FlowToken,
    effect: true,
    access: "human",
  },
  "flows.rows": {
    params: z
      .object({
        flow: Id,
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).max(200).optional(),
      })
      .strict(),
    result: z.object({
      rows: z.array(z.object({ key: z.string(), value: z.unknown(), updated_at: z.string().optional() })),
      nextCursor: z.string().nullable(),
    }),
    effect: false,
    access: "human",
  },
  "flows.write": {
    params: z.object({ flow: Id, key: z.string().min(1).max(128), value: z.unknown() }).strict(),
    result: z.object({ written: z.boolean() }),
    effect: true,
    access: "human",
  },
  "flows.events": {
    params: z
      .object({ flow: Id, limit: z.number().int().min(1).max(100).default(50), cursor: FlowEventCursor.optional() })
      .strict(),
    result: z.object({ events: z.array(FlowEvent), nextCursor: FlowEventCursor.nullable() }),
    effect: false,
    access: "human",
  },
  "flows.retire": {
    params: z.object({ flow: Id, confirm: z.literal(true), exported: z.literal(true) }).strict(),
    result: z.object({ retired: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** Would this data get past these checks? Nothing is saved, admitted or sent. */
  "flows.try": {
    params: z.object({ predicates: FlowPredicates, data: z.unknown() }).strict(),
    result: z.object({ matches: z.boolean() }),
    effect: false,
    access: "human",
  },
  "flows.retry": {
    params: z.object({ flow: Id, event: z.string().min(1).max(256) }).strict(),
    result: z.object({ queued: z.boolean() }),
    effect: true,
    access: "human",
  },
} as const;
