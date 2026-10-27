import { z } from "zod";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const Scalar = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
export const FlowAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("agent"), agent: Id, prompt: z.string().min(1).max(8000) }).strict(),
  z.object({ kind: z.literal("routine"), routine: Id }).strict(),
]);
export const FlowDefinition = z
  .object({
    id: Id,
    projectId: Id,
    name: z.string().min(1).max(120),
    enabled: z.boolean(),
    predicates: z
      .array(z.object({ path: z.array(z.string().min(1).max(128)).min(1).max(16), equals: Scalar }).strict())
      .max(32),
    tableKey: z.string().min(1).max(128),
    readKeys: z.array(z.string().min(1).max(128)).max(16).optional(),
    action: FlowAction,
  })
  .strict();
export type FlowDefinition = z.infer<typeof FlowDefinition>;
export const FlowEvent = z.object({
  flow_id: Id,
  event_id: z.string(),
  state: z.enum(["ignored", "written", "pending", "admitted", "failed"]),
  created_at: z.string(),
  run_id: z.string().nullable(),
  run_state: z.string().nullable(),
  error: z.string().nullable(),
});
export const FlowEventCursor = z
  .object({ createdAt: z.string().datetime(), eventId: z.string().min(1).max(256) })
  .strict();
export type FlowEventCursor = z.infer<typeof FlowEventCursor>;
export const flowMethods = {
  "flows.list": {
    params: z.object({ project: Id }).strict(),
    result: z.object({ flows: z.array(FlowDefinition) }),
    effect: false,
    access: "human",
  },
  "flows.set": { params: FlowDefinition, result: FlowDefinition, effect: true, access: "human" },
  "flows.rows": {
    params: z
      .object({
        flow: Id,
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).max(128).optional(),
      })
      .strict(),
    result: z.object({
      rows: z.array(z.object({ key: z.string(), value: z.unknown() })),
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
  "flows.retry": {
    params: z.object({ flow: Id, event: z.string().min(1).max(256) }).strict(),
    result: z.object({ queued: z.boolean() }),
    effect: true,
    access: "human",
  },
} as const;
