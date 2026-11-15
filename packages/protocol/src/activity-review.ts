import { z } from "zod";
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

export const activityReviewMethods = {
  "activity_review.settings": {
    params: z.object({}).strict(),
    result: ActivityReviewStatus,
    effect: false,
    access: "human",
  },
  "activity_review.configure": {
    params: ActivityReviewSettings.partial()
      .extend(
        schemaFields({
          expected: () => ActivityReviewSettings.optional(),
        }),
      )
      .strict(),
    result: ActivityReviewStatus,
    effect: true,
    access: "human",
  },
} as const;
