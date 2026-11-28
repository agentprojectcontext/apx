// How trips and offers reach clients: the stored rows with their words and Maps links.
import type { CarAction, CarAlert, CarErrand, CarPlace, CarTrip } from "@apx/protocol";
import type { AlertRow, Hold } from "../domain/car-alerts.ts";
import type { TripRow } from "../domain/car-trips.ts";
import { heldNow, type MatchContext, type MatchErrand, rank } from "./matcher.ts";
import type { OpenErrand } from "./plan.ts";
import type { FoundPlace } from "./provider.ts";
import { addStopUrl, distanceLabel, type Lang, navigateUrl, offerSpoken, offerTitle } from "./wording.ts";

export function publicTrip(t: TripRow): CarTrip {
  const { device_id: _device, last_alert_at: _last, ...trip } = t;
  return trip;
}

/** What a screen shows of a found place: the matcher's extra fields stay in the core. */
export function shownPlace(p: FoundPlace, preferred: boolean): CarPlace {
  const { categories, brand: _brand, opening_hours: _hours, ...place } = p;
  return {
    ...place,
    ...(place.category || !categories[0] ? {} : { category: categories[0] }),
    ...(preferred ? { preferred: true } : {}),
  };
}

export function alertView(a: AlertRow, trip: TripRow | undefined, lang: Lang): CarAlert {
  const stop = addStopUrl(a.place, trip?.destination);
  const actions: CarAction[] = [
    "navigate",
    ...(stop ? (["add_stop"] as const) : []),
    "next",
    "later",
    "skip",
    "silence",
    "done",
  ];
  return {
    id: a.id,
    trip_id: a.trip_id,
    task_id: a.task_id,
    errand: a.errand,
    place: a.place,
    distance_m: a.distance_m,
    distance_label: distanceLabel(a.distance_m, lang),
    title: offerTitle(a.errand, a.place, a.distance_m, lang),
    spoken: offerSpoken(a.errand, a.place, a.distance_m, lang),
    actions,
    navigate_url: navigateUrl(a.place),
    ...(stop ? { add_stop_url: stop } : {}),
    at: a.at,
    ...(a.answer ? { answer: a.answer } : {}),
    ...(a.answered_at ? { answered_at: a.answered_at } : {}),
  };
}

/** Open errands as the car lists them, each with its best place where the trip knows one. */
export function errandViews(
  errands: readonly OpenErrand[],
  matched: readonly MatchErrand[],
  ctx: MatchContext | undefined,
  locked: ReadonlyMap<string, CarPlace>,
): CarErrand[] {
  return errands.map((e, i) => {
    const held = ctx ? heldNow(e.task_id, ctx.holds, ctx.position, ctx.now) : undefined;
    const lock = locked.get(e.task_id);
    const top =
      ctx && !lock ? rank(matched[i] ?? { task_id: e.task_id, place: e.place, candidates: [] }, ctx)[0] : undefined;
    const pref = top ? ctx?.prefs.get(top.place.key) : undefined;
    return {
      task_id: e.task_id,
      title: e.title,
      ...(e.place ? { place: e.place } : {}),
      ...(lock ? { best: lock } : {}),
      ...(top
        ? {
            best: shownPlace(top.place, pref?.choice === "prefer" || (pref?.accepted ?? 0) > 0),
            distance_m: Math.round(top.distance_m),
          }
        : {}),
      ...(held === "skip" || held === "later" ? { held } : {}),
    };
  });
}

/** The place each errand is going to in this trip (answered navigate or add a stop). */
export function lockedPlaces(holds: readonly Hold[], alerts: readonly AlertRow[]): Map<string, CarPlace> {
  const out = new Map<string, CarPlace>();
  for (const h of holds) {
    if (h.kind !== "lock") continue;
    const a = alerts.find((x) => x.task_id === h.task_id && x.place.key === h.place_key);
    if (a) out.set(h.task_id, a.place);
  }
  return out;
}
