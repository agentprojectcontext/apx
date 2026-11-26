import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { schemaFields } from "./schema-fields.ts";

export const ContinuationCondition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("time"), at: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ kind: z.literal("task_done"), task: z.string().min(1).max(120) }).strict(),
]);
export type ContinuationCondition = z.infer<typeof ContinuationCondition>;

export const ChatContinuation = z.object(
  schemaFields({
    id: () => z.string(),
    thread_id: () => z.string(),
    agent_id: () => z.string(),
    project_id: () => z.string().optional(),
    purpose: () => z.string(),
    condition: () => ContinuationCondition,
    expires_at: () => z.string(),
    created_at: () => z.string(),
    state: () => z.enum(["pending", "admitted", "completed", "canceled", "expired", "blocked", "failed"]),
    run_id: () => z.string().optional(),
    reason: () => z.string().optional(),
  }),
);
export type ChatContinuation = z.infer<typeof ChatContinuation>;

export const continuationMethods = {
  "continuations.create": deferMethod({
    params: () =>
      z
        .object({
          thread: z.string().min(1),
          purpose: z.string().trim().min(1).max(2000),
          condition: ContinuationCondition,
          expires_at: z.iso.datetime({ offset: true }),
        })
        .strict(),
    result: () => ChatContinuation,
    effect: true,
    access: "human",
  }),
  "continuations.list": deferMethod({
    params: () => z.object({ thread: z.string().min(1) }).strict(),
    result: () => z.object({ continuations: z.array(ChatContinuation) }),
    effect: false,
  }),
  "continuations.cancel": deferMethod({
    params: () => z.object({ thread: z.string().min(1), id: z.string().min(1) }).strict(),
    result: () => ChatContinuation,
    effect: true,
  }),
} as const;
