// Synced from apps/web/src/routines/slots.ts by scripts/sync-design-assets.mjs.
import type { RoutineRun, Schedule } from "../../../../packages/protocol/src/index.ts";
import { weeklyOf } from "./cron.ts";

/** How many activations a routine's row shows. */
export const SLOTS = 14;
/** A run that starts a little before its time (clock skew) still counts for that time. */
const GRACE = 60_000;

/** One bar: when the schedule expected a run (if it says), and the run that happened then, if any. */
export type Slot = { at?: string; run?: RoutineRun };

/**
 * The last `n` moments the schedule fired up to `now`, oldest first; undefined when the schedule cannot say (once,
 * by hand, or a cron that is not "these days at this time"). `anchor` is any moment an "every" schedule fired or will.
 */
export function expectedTimes(s: Schedule, now: Date, n: number, anchor?: string): Date[] | undefined {
  if (s.kind === "every") {
    const step = s.minutes * 60_000;
    const at = anchor ? Date.parse(anchor) : Number.NaN;
    // Lined up with a real firing (the next one, or the last run), so every slot matches one.
    let t = Number.isNaN(at) ? now.getTime() : at;
    while (t > now.getTime()) t -= step;
    while (t + step <= now.getTime()) t += step;
    return Array.from({ length: n }, (_, i) => new Date(t - (n - 1 - i) * step));
  }
  if (s.kind !== "cron") return undefined;
  const w = weeklyOf(s.cron);
  if (!w?.days.length) return undefined;
  const [h = 9, m = 0] = w.time.split(":").map(Number);
  const out: Date[] = [];
  const day = new Date(now);
  for (let i = 0; out.length < n && i <= 7 * n; i++) {
    // Hours set on every step: a DST change between days would shift them otherwise.
    day.setHours(h, m, 0, 0);
    if (day <= now && w.days.includes(day.getDay())) out.unshift(new Date(day));
    day.setDate(day.getDate() - 1);
  }
  return out;
}

/**
 * Always `n` bars. With a schedule that says when it fires, one per expected moment, holding the latest run that
 * started before the next one (gray when none did); otherwise the last runs, padded with gray on the left.
 * `runs` come newest first, as `routines.runs` returns them.
 */
export function activationSlots(s: Schedule, runs: readonly RoutineRun[], now: Date, next?: string, n = SLOTS): Slot[] {
  const times = expectedTimes(s, now, n, next ?? runs[0]?.started_at);
  if (!times?.length) {
    const last = runs
      .slice(0, n)
      .reverse()
      .map((run) => ({ at: run.started_at, run }));
    return [...Array.from({ length: n - last.length }, () => ({})), ...last];
  }
  const slots: Slot[] = times.map((t, i) => {
    const from = t.getTime() - GRACE;
    const to = (times[i + 1]?.getTime() ?? Number.POSITIVE_INFINITY) - GRACE;
    const run = runs.find((r) => {
      const at = Date.parse(r.started_at);
      return at >= from && at < to;
    });
    return run ? { at: t.toISOString(), run } : { at: t.toISOString() };
  });
  // Fewer moments than bars (a cron on one weekday found few in range): pad the oldest side.
  return [...Array.from({ length: n - slots.length }, () => ({})), ...slots];
}
