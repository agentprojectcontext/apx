// Which errand to offer at a position, and where (rules/ERRANDS_ON_THE_WAY.md#the-matcher-per-position). Pure: the
// caller brings the trip's holds, the owner's answers per place and the candidates already found.
import type { CarReach, ErrandPlace, PreferredPlace } from "@apx/protocol";
import type { Hold } from "../domain/car-alerts.ts";
import { normalizeText } from "./categories.ts";
import { angleDiff, bearingDeg, distanceM, type Point } from "./geo.ts";
import type { FoundPlace } from "./provider.ts";

export const REACH_M: Record<CarReach, number> = { near: 600, normal: 1500, far: 4000 };
/** Reach grows to this much driving at the current speed, up to twice the base. */
const REACH_SECONDS = 90;
/** Moving faster than this, the heading counts. */
const MOVING_MPS = 4;
/** More than this off the heading is behind the car: offered only when very close. */
const BEHIND_DEG = 100;
const BEHIND_M = 300;
/** More than this off the heading is off the way: it costs more. */
const ASIDE_DEG = 60;
const ASIDE_FACTOR = 1.6;
/** A fix worse than this is not used. */
export const WORST_ACCURACY_M = 300;
/** Offers in one trip are at least this far apart in time. */
const SPACING_MS = 45_000;
/** `later` holds an errand this long and this far, whichever comes later. */
export const LATER_MS = 15 * 60_000;
const LATER_M = 3000;

type Position = Point & { speed_mps?: number | undefined; heading_deg?: number | undefined };

export type MatchErrand = {
  task_id: string;
  place: ErrandPlace | undefined;
  candidates: readonly FoundPlace[];
};

export type Ranked = { place: FoundPlace; distance_m: number; score: number };

export type MatchContext = {
  position: Position;
  reach: CarReach;
  holds: readonly Hold[];
  prefs: ReadonlyMap<string, PreferredPlace>;
  avoided: ReadonlySet<string>;
  now: Date;
};

/** How far an errand reaches at this speed. */
export function reachM(reach: CarReach, speed_mps: number | undefined, radius_m?: number): number {
  const base = radius_m ?? REACH_M[reach];
  return Math.max(base, Math.min((speed_mps ?? 0) * REACH_SECONDS, 2 * base));
}

/** Whether the trip holds the errand now (left for the trip, waiting, or already going to a place). */
export function heldNow(
  task_id: string,
  holds: readonly Hold[],
  at: Point,
  now: Date,
): "skip" | "later" | "lock" | undefined {
  const mine = holds.filter((h) => h.task_id === task_id);
  // Left for the trip, or going somewhere, outlasts any wait.
  const fixed = mine.find((h) => h.kind === "skip" || h.kind === "lock");
  if (fixed) return fixed.kind as "skip" | "lock";
  const waiting = mine.some(
    (h) =>
      h.kind === "later" &&
      ((h.until_at !== undefined && now.toISOString() < h.until_at) ||
        (h.until !== undefined && distanceM(h.until, at) < LATER_M)),
  );
  return waiting ? "later" : undefined;
}

const brandMatches = (place: FoundPlace, brand: string | undefined) => {
  if (!brand) return true;
  const wanted = normalizeText(brand);
  return normalizeText(`${place.brand ?? ""} ${place.name}`).includes(wanted);
};

/** Lower is better: metres, bent by the way the car goes, the owner's answers, the hours and the rating. */
function score(place: FoundPlace, distance: number, aside: boolean, pref: PreferredPlace | undefined): number {
  let s = distance * (aside ? ASIDE_FACTOR : 1);
  if (pref?.choice === "prefer") s -= 600;
  if (pref) s += -Math.min(pref.accepted * 150, 600) + pref.declined * 300;
  if (place.closes_soon) s += 300;
  else if (place.open === "open") s -= 200;
  if (place.rating !== undefined) s -= (place.rating - 4) * 200;
  return s;
}

/** An errand's places within reach, best first, without those declined this trip, avoided, closed or of another brand. */
export function rank(errand: MatchErrand, ctx: MatchContext): Ranked[] {
  const { position: at } = ctx;
  const declined = new Set(
    ctx.holds.filter((h) => h.task_id === errand.task_id && h.kind === "declined_place").map((h) => h.place_key),
  );
  const reach = reachM(ctx.reach, at.speed_mps, errand.place?.radius_m);
  const moving = (at.speed_mps ?? 0) > MOVING_MPS && at.heading_deg !== undefined;
  const out: Ranked[] = [];
  for (const place of errand.candidates) {
    if (declined.has(place.key) || ctx.avoided.has(place.key) || place.open === "closed") continue;
    if (!errand.place?.at && !brandMatches(place, errand.place?.brand)) continue;
    const distance = distanceM(at, place);
    if (distance > reach) continue;
    const off = moving ? angleDiff(at.heading_deg as number, bearingDeg(at, place)) : 0;
    if (off > BEHIND_DEG && distance > BEHIND_M) continue;
    out.push({ place, distance_m: distance, score: score(place, distance, off > ASIDE_DEG, ctx.prefs.get(place.key)) });
  }
  return out.sort((a, b) => a.score - b.score);
}

/** At most one offer for this position: the best-scoring errand within reach that the trip has not spent or held. */
export function pick(
  errands: readonly MatchErrand[],
  spent: ReadonlySet<string>,
  ctx: MatchContext,
): (Ranked & { task_id: string }) | undefined {
  let best: (Ranked & { task_id: string }) | undefined;
  for (const e of errands) {
    if (spent.has(e.task_id) || heldNow(e.task_id, ctx.holds, ctx.position, ctx.now)) continue;
    const top = rank(e, ctx)[0];
    if (top && (!best || top.score < best.score)) best = { ...top, task_id: e.task_id };
  }
  return best;
}

/** Why no offer is looked for at this position, if any (spacing, a bad fix, a silenced trip). */
export function quiet(o: {
  silenced: boolean;
  accuracy_m?: number | undefined;
  last_alert_at?: string | undefined;
  now: Date;
}): "silenced" | "accuracy" | "spacing" | undefined {
  if (o.silenced) return "silenced";
  if ((o.accuracy_m ?? 0) > WORST_ACCURACY_M) return "accuracy";
  if (o.last_alert_at && o.now.getTime() - Date.parse(o.last_alert_at) < SPACING_MS) return "spacing";
  return undefined;
}
