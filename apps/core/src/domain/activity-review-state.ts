import { ActivityReviewSettings } from "@apx/protocol";
import { z } from "zod";
import { conflict } from "../errors.ts";
import type { Store } from "./store.ts";

export const REVIEW_DAY = 86_400_000;
const KEY = "activity_review_runtime";
const Runtime = z.object({
  cursor: z.string().datetime(),
  next: z.string().datetime(),
  last: z.string().datetime().optional(),
  state: z.enum(["waiting", "working", "completed", "failed", "uncertain", "cancelled"]),
  seen: z.array(z.string()).max(200),
});
export type ReviewRuntime = z.infer<typeof Runtime>;
export const reviewPeriod = (s: ActivityReviewSettings) => (s.frequency === "weekly" ? 7 * REVIEW_DAY : REVIEW_DAY);

export function activityReviewState(store: Store, now: () => Date) {
  const write = (r: ReviewRuntime) => store.settings.set(KEY, JSON.stringify(r));
  const read = (): ReviewRuntime => {
    try {
      return Runtime.parse(JSON.parse(store.settings.get(KEY) ?? ""));
    } catch {
      const at = now();
      const r: ReviewRuntime = {
        cursor: at.toISOString(),
        next: new Date(+at + reviewPeriod(store.settings.read("activity_review"))).toISOString(),
        state: "waiting",
        seen: [],
      };
      write(r);
      return r;
    }
  };
  return {
    read,
    write,
    configure(patch: Partial<ActivityReviewSettings>, expected?: ActivityReviewSettings) {
      const before = store.settings.read("activity_review");
      if (expected && JSON.stringify(before) !== JSON.stringify(expected))
        throw conflict("Activity review settings changed; reload before saving");
      const settings = ActivityReviewSettings.parse({ ...before, ...patch });
      store.tx(() => {
        store.settings.write("activity_review", settings);
        const r = read();
        const at = now();
        const reset = settings.enabled !== before.enabled || settings.frequency !== before.frequency;
        write({
          ...r,
          state: "cancelled",
          ...(reset
            ? {
                cursor: at.toISOString(),
                next: new Date(+at + reviewPeriod(settings)).toISOString(),
              }
            : {}),
        });
      });
    },
  };
}
