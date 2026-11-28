// What the owner's answer to an offer does (rules/ERRANDS_ON_THE_WAY.md#the-matcher-per-position, step 7): holds in
// the trip, counts for the place, and for `next` the errand's next place right away.
import type { CarAction, CarAlert, CarErrand, CarPlace, ErrandCategory } from "@apx/protocol";
import type { AlertRow } from "../domain/car-alerts.ts";
import type { TripRow } from "../domain/car-trips.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { LATER_MS, type MatchContext, rank } from "./matcher.ts";
import type { OpenErrand, Plans } from "./plan.ts";
import { shownPlace } from "./view.ts";
import { navigateUrl } from "./wording.ts";

const GOING: readonly CarAction[] = ["navigate", "add_stop"];

export type AnswerEnv = {
  store: Store;
  plans: Plans;
  now: () => Date;
  /** The errand as the search sees it, if it is still open. */
  errand: (task_id: string) => OpenErrand | undefined;
  /** The matcher's context at the trip's last point; unset without one. */
  context: (trip: TripRow) => MatchContext | undefined;
  view: (a: AlertRow) => CarAlert;
  changed: (alert?: CarAlert) => void;
};

const categoriesOf = (env: AnswerEnv, task_id: string, place: CarPlace): ErrandCategory[] =>
  env.errand(task_id)?.place?.categories ?? (place.category ? [place.category] : []);

function closeTask(env: AnswerEnv, task_id: string): void {
  const t = env.store.tasks.get(task_id);
  if (t?.state === "open") env.store.tasks.change(task_id, { state: "done", awaits_owner: false }, "owner");
}

/** The errand's best place not declined this trip, offered now (the owner asked for another one). */
function offerNext(env: AnswerEnv, trip: TripRow, task_id: string, at: string): AlertRow | undefined {
  const e = env.errand(task_id);
  const ctx = env.context(trip);
  if (!e || !ctx) return undefined;
  const [matched] = env.plans.cached(trip.id, [e]);
  const top = matched ? rank(matched, ctx)[0] : undefined;
  if (!top) return undefined;
  const pref = ctx.prefs.get(top.place.key);
  const alert = env.store.carAlerts.add({
    trip_id: trip.id,
    task_id,
    errand: e.title,
    place: shownPlace(top.place, pref?.choice === "prefer" || (pref?.accepted ?? 0) > 0),
    distance_m: top.distance_m,
    at,
  });
  env.store.carTrips.alerted(trip.id, at);
  return alert;
}

export function answerAlert(env: AnswerEnv, alert_id: string, action: CarAction): { alert: CarAlert; next?: CarAlert } {
  const { store } = env;
  const a = store.carAlerts.get(alert_id);
  if (!a) throw notFound(`offer ${alert_id}`);
  if (a.answer === action) return { alert: env.view(a) };
  const at = env.now().toISOString();
  const trip = store.carTrips.get(a.trip_id);
  const cats = categoriesOf(env, a.task_id, a.place);
  let next: AlertRow | undefined;
  store.tx(() => {
    if (GOING.includes(action)) {
      store.carAlerts.hold(a.trip_id, { task_id: a.task_id, kind: "lock", place_key: a.place.key }, at);
      if (!a.answer || !GOING.includes(a.answer)) store.carPrefs.count(a.place, cats, "accepted", at);
    } else if (action === "next") {
      store.carAlerts.hold(a.trip_id, { task_id: a.task_id, kind: "declined_place", place_key: a.place.key }, at);
      store.carPrefs.count(a.place, cats, "declined", at);
    } else if (action === "later") {
      const p = trip?.position;
      store.carAlerts.hold(
        a.trip_id,
        {
          task_id: a.task_id,
          kind: "later",
          until_at: new Date(env.now().getTime() + LATER_MS).toISOString(),
          ...(p ? { until: { lat: p.lat, lon: p.lon } } : {}),
        },
        at,
      );
    } else if (action === "skip") store.carAlerts.hold(a.trip_id, { task_id: a.task_id, kind: "skip" }, at);
    else if (action === "silence") store.carTrips.silence(a.trip_id);
    else if (action === "done") {
      if (a.answer && GOING.includes(a.answer)) store.carPrefs.count(a.place, cats, "done", at);
      closeTask(env, a.task_id);
    }
    store.carAlerts.answer(a.id, action, at);
    if (action === "next" && trip && !trip.ended_at && !trip.silenced) next = offerNext(env, trip, a.task_id, at);
  });
  const answered = env.view(store.carAlerts.get(a.id) as AlertRow);
  const nextView = next ? env.view(next) : undefined;
  env.changed(nextView);
  return { alert: answered, ...(nextView ? { next: nextView } : {}) };
}

/** An errand from the car's list, without an offer: go to its best place now, leave it for the trip, or done. */
export function errandAction(
  env: AnswerEnv,
  trip: TripRow | undefined,
  task_id: string,
  action: "navigate" | "skip" | "done",
  best: (trip: TripRow, task_id: string) => CarErrand | undefined,
): { errand?: CarErrand; navigate_url?: string } {
  const { store } = env;
  const e = env.errand(task_id);
  if (!e) throw notFound(`errand ${task_id}`);
  const at = env.now().toISOString();
  if (action === "done") {
    closeTask(env, task_id);
    env.changed();
    return {};
  }
  if (!trip) throw badRequest("no trip is going on");
  if (action === "skip") {
    store.carAlerts.hold(trip.id, { task_id, kind: "skip" }, at);
    env.changed();
    const errand = best(trip, task_id);
    return errand ? { errand } : {};
  }
  const shown = best(trip, task_id);
  if (!shown?.best) throw badRequest("no place found for this errand here yet");
  const place = shown.best;
  // Recorded as an offer answered "navigate", so the trip keeps the place it is going to.
  store.tx(() => {
    const row = store.carAlerts.add({
      trip_id: trip.id,
      task_id,
      errand: e.title,
      place,
      distance_m: shown.distance_m ?? 0,
      at,
    });
    store.carAlerts.answer(row.id, "navigate", at);
    store.carAlerts.hold(trip.id, { task_id, kind: "lock", place_key: place.key }, at);
    store.carPrefs.count(place, categoriesOf(env, task_id, place), "accepted", at);
  });
  env.changed();
  return { errand: best(trip, task_id) ?? shown, navigate_url: navigateUrl(place) };
}
