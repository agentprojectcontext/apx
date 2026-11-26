import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { schemaFields } from "./schema-fields.ts";

export const ActivityReviewSettings = z
  .object(
    schemaFields({
      enabled: () => z.boolean(),
      frequency: () => z.enum(["daily", "weekly"]),
      extra_details: () => z.string().max(2000),
    }),
  )
  .strict();
export type ActivityReviewSettings = z.infer<typeof ActivityReviewSettings>;

export const ActivityReviewStatus = z.object(
  schemaFields({
    settings: () => ActivityReviewSettings,
    available: () => z.boolean(),
    next_at: () => z.string().optional(),
    last_at: () => z.string().optional(),
    state: () => z.enum(["waiting", "working", "completed", "failed", "uncertain", "cancelled"]),
  }),
);

export type ActivityReviewStatus = z.infer<typeof ActivityReviewStatus>;

/** What became of a proposal: still to accept, accepted and open, done, dropped, or its task deleted. */
export const ActivityReviewOutcome = z.enum(["pending", "accepted", "done", "dropped", "deleted"]);
export type ActivityReviewOutcome = z.infer<typeof ActivityReviewOutcome>;

/** One review that read conversations; `chats`/`messages`/`since` are absent for reviews made before the history. */
export const ActivityReviewRun = z.object(
  schemaFields({
    id: () => z.string(),
    at: () => z.string(),
    since: () => z.string().optional(),
    state: () => z.enum(["working", "completed", "failed", "cancelled", "uncertain"]),
    chats: () => z.number().int().optional(),
    messages: () => z.number().int().optional(),
    proposals: () =>
      z.array(
        z.object(
          schemaFields({
            task_id: () => z.string(),
            title: () => z.string(),
            project_id: () => z.string().optional(),
            outcome: () => ActivityReviewOutcome,
          }),
        ),
      ),
  }),
);
export type ActivityReviewRun = z.infer<typeof ActivityReviewRun>;

export const activityReviewMethods = {
  "activity_review.settings": deferMethod({
    params: () => z.object({}).strict(),
    result: () => ActivityReviewStatus,
    effect: false,
    access: "human",
  }),
  /** Past reviews, newest first; `next` is the `before` of the following page. */
  "activity_review.history": deferMethod({
    params: () =>
      z
        .object({ limit: z.number().int().min(1).max(50).default(10), before: z.string().datetime().optional() })
        .strict(),
    result: () => z.object({ runs: z.array(ActivityReviewRun), next: z.string().optional() }),
    effect: false,
    access: "human",
  }),
  "activity_review.configure": deferMethod({
    params: () =>
      ActivityReviewSettings.partial()
        .extend({
          expected: ActivityReviewSettings.optional(),
        })
        .strict(),
    result: () => ActivityReviewStatus,
    effect: true,
    access: "human",
  }),
} as const;
