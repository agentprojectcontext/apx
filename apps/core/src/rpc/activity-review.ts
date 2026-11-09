import type { ActivityReview } from "../engine/activity-review.ts";
import type { Handlers } from "./router.ts";

export function activityReviewHandlers(review: ActivityReview) {
  return {
    "activity_review.settings": () => review.status(),
    "activity_review.configure": ({ expected, ...patch }) => review.configure(patch, expected),
  } satisfies Partial<Handlers>;
}
