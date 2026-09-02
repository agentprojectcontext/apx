// Live proximity alerts while a trip is in progress.
//
// ./osm-route.js answers ONE question, once, at trip start: "does the planned
// route pass anything I have a pending task for?". This module answers a
// different one, continuously: "am I NEAR one of those places RIGHT NOW?".
// They share the need vocabulary (taskNeeds) and the place search (nearbyPois)
// and nothing else — one is a route-geometry check against a polyline, this is
// a distance check against a live GPS stream.
//
// The contract this file exists to keep: ONE alert per (trip, task, place).
// Not one per position sample, not one per re-approach, not one more after a
// daemon restart. A reminder that repeats while someone is driving is worse
// than no reminder at all, which is why the one-shot is burned in persistent
// state (./state.js) BEFORE the message is sent — a failed Telegram call is
// not a licence to try the same reminder again two seconds later.
//
// The SECOND contract, and the reason for the plan below: a drive costs a
// bounded number of place searches, ideally one, and never a search per GPS
// sample. See ensureTripPlan().
import { t } from "#core/i18n/index.js";
import { categoryIsLocatable } from "#core/constants/task-categories.js";
import { activeTasks, haversineMeters, nearbyPois, taskNeeds } from "./osm-route.js";
import { listMobilityAlerts, mobilityAlertFired, mobilityContext } from "./state.js";

// 2 km. The owner asked to hear about a place "at one or two kilometres" —
// far enough to still change lanes for it, close enough that it is genuinely
// on the way rather than merely in the same town.
export const PROXIMITY_RADIUS_M = 2_000;

// Targets are places, and places don't move: they are searched once per trip.
// A drive that leaves the searched area by this much gets a fresh search, so a
// long trip still sees the shops at the far end without turning every GPS
// sample into a Nominatim request.
const RETARGET_DISTANCE_M = 8_000;

// ~13 km around the current position. Nominatim needs a box with area, and a
// box built from a single point has none — see boundingBox()'s padDegrees.
const SEARCH_PAD_DEGREES = 0.12;

// A city search can match thirty shops. The banner's list is "what is near me
// on this drive", not a directory — past the nearest handful nobody is
// detouring, and a long list is unreadable at a red light.
const MAX_LISTED_PLACES = 8;

// Per-trip plan, held in memory. Deliberately NOT persisted: it is a derived
// cache (rebuilt from tasks + one place search), while the thing that must
// survive a restart — which reminders were already delivered — lives in
// ./state.js. Two lifetimes, two homes.
const armed = new Map();

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Validate an inbound GPS sample. Throws with a caller-facing message, the
 * same shape acceptMobilityEvent() uses, so the route can answer 400 without
 * knowing anything about coordinates.
 */
export function acceptMobilityPosition(body = {}, now = Date.now()) {
  const latitude = finite(body.latitude);
  const longitude = finite(body.longitude);
  if (latitude == null || longitude == null) throw new Error("latitude and longitude required");
  if (latitude < -90 || latitude > 90) throw new Error("latitude out of range");
  if (longitude < -180 || longitude > 180) throw new Error("longitude out of range");
  const tripId = text(body.trip_id, 100);
  if (!tripId) throw new Error("trip_id required");
  return {
    trip_id: tripId,
    latitude,
    longitude,
    accuracy_m: finite(body.accuracy_m),
    speed_mps: finite(body.speed_mps),
    heading_deg: finite(body.heading_deg),
    occurred_at: text(body.occurred_at, 50) || new Date(now).toISOString(),
    source: text(body.source, 40) || "android",
  };
}

/**
 * Every place worth watching on this trip: one entry per (pending task × place
 * that satisfies it). Built from the tasks themselves — a task that names no
 * physical errand produces no target, so a trip with nothing to buy is silent
 * without a single network call.
 */
export async function buildTripTargets(position, ctx, fetchFn = fetch) {
  const open = activeTasks(ctx.projects);

  // A task that already carries its own pinned place is the cheap path and the
  // exact one: no geocoding, no place search, no model reading the title to
  // guess what kind of errand it is. That is what a `trip` category with a
  // location is FOR — see core/constants/task-categories.js.
  const pinned = [];
  const unpinned = [];
  for (const task of open) {
    const spot = task.location;
    if (categoryIsLocatable(task.category) && spot?.latitude != null && spot?.longitude != null) {
      pinned.push({
        task_id: task.id,
        task: task.title || "",
        project_id: task.project_id ?? task.projectId ?? "",
        need_id: "pinned",
        place: spot.place || spot.address || task.title || "",
        latitude: spot.latitude,
        longitude: spot.longitude,
        ...(Number.isFinite(spot.radius_m) ? { radius_m: spot.radius_m } : {}),
      });
      continue;
    }
    unpinned.push(task);
  }

  // Everything else still goes through the need vocabulary: a title that names
  // a pharmacy, with no place attached, is worth searching for.
  const rows = unpinned
    .map((task) => ({ task, needs: taskNeeds(task) }))
    .filter((row) => row.needs.length);
  if (!rows.length) return pinned;

  const needs = [...new Map(
    rows.flatMap((row) => row.needs).map((need) => [`${need.id}:${need.query}`, need])
  ).values()];
  const places = await nearbyPois(
    { points: [{ latitude: position.latitude, longitude: position.longitude }] },
    needs,
    fetchFn,
    { padDegrees: SEARCH_PAD_DEGREES }
  );

  const targets = [...pinned];
  for (const row of rows) {
    for (const place of places) {
      if (!row.needs.some((need) => need.id === place.tags?.need_id)) continue;
      targets.push({
        task_id: row.task.id,
        task: row.task.title || "",
        project_id: row.task.project_id ?? row.task.projectId ?? "",
        need_id: place.tags.need_id,
        place: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
      });
    }
  }
  return targets;
}

/**
 * What the open errands are, as one short string. This is the ONLY thing that
 * expires a plan besides distance, and it replaced a blind ten-minute timer.
 *
 * The timer was the wrong instrument: on a drive where nothing changes it paid
 * for a search every ten minutes to re-learn the same answer, and on the case
 * it existed for — a task added from the phone mid-drive — it still left the
 * new errand invisible for up to ten minutes. Reading the task list is a local
 * file read: no network, no API bill, no model. So we read it every sample and
 * search only when the answer would actually differ.
 */
function errandFingerprint(open) {
  return open
    .filter((task) => categoryIsLocatable(task.category) || taskNeeds(task).length)
    .map((task) => {
      const spot = task.location;
      const pin = spot?.latitude != null ? `@${spot.latitude},${spot.longitude}` : "";
      return `${task.id}${pin}`;
    })
    .sort()
    .join("|");
}

/**
 * Group flat targets into one entry per ERRAND, each holding every place that
 * could satisfy it.
 *
 * "Buy bread" is not a place, it is a choice between places — the corner shop,
 * the supermarket, the other supermarket. Keeping the candidates instead of
 * collapsing them at search time is what lets the choice follow the driver:
 * re-ranking them as the car moves is pure arithmetic on numbers we already
 * have, while re-deciding by searching again is a network call.
 */
function toErrands(targets, previous = new Map()) {
  const errands = new Map();
  for (const target of targets) {
    let errand = errands.get(target.task_id);
    if (!errand) {
      const before = previous.get(target.task_id);
      errand = {
        task_id: target.task_id,
        task: target.task,
        project_id: target.project_id,
        candidates: [],
        chosen: null,
        // A lock survives a re-search: the owner already said WHERE, and a
        // fresh list of shops is not a reason to change the answer.
        locked: Boolean(before?.locked),
        lock_reason: before?.lock_reason || null,
      };
      errands.set(target.task_id, errand);
    }
    errand.candidates.push(target);
  }
  // Re-attach the place a locked errand was locked TO, even if this search did
  // not return it. Losing it would silently unlock the errand.
  for (const [taskId, before] of previous) {
    const errand = errands.get(taskId);
    if (!errand || !before.locked || !before.chosen) continue;
    if (!errand.candidates.some((candidate) => sameSpot(candidate, before.chosen))) {
      errand.candidates.push(before.chosen);
    }
  }
  for (const errand of errands.values()) {
    // A single candidate IS the decision. There is nothing left to re-rank, so
    // this errand never costs another search for the rest of the trip — which
    // is the pinned-task path and, in a small town, most of the others too.
    if (errand.candidates.length === 1 && !errand.locked) {
      errand.locked = true;
      errand.lock_reason = errand.candidates[0].need_id === "pinned" ? "pinned" : "only-candidate";
    }
  }
  return errands;
}

function sameSpot(a, b) {
  return a && b && a.latitude === b.latitude && a.longitude === b.longitude;
}

/** Point each errand at its nearest candidate. Arithmetic only — never a call. */
function rank(errands, position) {
  for (const errand of errands.values()) {
    // A locked errand keeps its PLACE. This is the owner's "unless we already
    // have one single place to go": once the answer is settled, driving past
    // a closer branch does not re-open the question.
    //
    // Its DISTANCE is not settled, though, and must be re-measured like anyone
    // else's: the car is driving TOWARD that place, and how far away it is now
    // is the whole basis of the proximity check. Keeping the number the lock
    // was taken with froze it at the first sample of the trip — and since
    // prepareTripPlan warms the plan from the ORIGIN, that number is the
    // distance from where the drive started. A pinned errand (locked on sight,
    // by definition) could therefore never come into range: you arrive at the
    // shop and evaluateMobilityPosition is still comparing the radius against
    // how far the shop is from your house.
    if (errand.locked && errand.chosen) {
      errand.chosen = {
        ...errand.chosen,
        distance_m: Math.round(haversineMeters(position, errand.chosen)),
      };
      continue;
    }
    let best = null;
    for (const candidate of errand.candidates) {
      const distance_m = Math.round(haversineMeters(position, candidate));
      if (!best || distance_m < best.distance_m) best = { ...candidate, distance_m };
    }
    errand.chosen = best;
  }
  return errands;
}

/**
 * The trip's plan: every open errand, the places that could satisfy it, and
 * which one it is currently pointed at.
 *
 * A search happens when — and only when — the plan cannot answer from what it
 * already holds:
 *
 *   1. there is no plan yet (once per trip, at boarding);
 *   2. the car has left the searched area by RETARGET_DISTANCE_M, so the
 *      shops at the far end of a long drive were never in the first answer;
 *   3. the open errands changed, which is a local file read away.
 *
 * And never at all once every errand is locked: at that point the plan is a
 * finished decision and more searching cannot change it. A normal drive with a
 * settled shopping list therefore costs ONE search — or zero, when the tasks
 * carry their own pins.
 */
export async function ensureTripPlan(position, ctx, fetchFn = fetch, now = Date.now()) {
  const cached = armed.get(position.trip_id);
  const open = activeTasks(ctx.projects);
  const fingerprint = errandFingerprint(open);
  if (cached) {
    const settled = cached.errands.size > 0 &&
      [...cached.errands.values()].every((errand) => errand.locked);
    const nearby = haversineMeters(cached.searchedAt, position) < RETARGET_DISTANCE_M;
    if (settled || (nearby && cached.fingerprint === fingerprint)) {
      cached.lastPosition = { latitude: position.latitude, longitude: position.longitude };
      return rank(cached.errands, position);
    }
  }
  let targets = [];
  try {
    targets = await buildTripTargets(position, ctx, fetchFn);
  } catch (error) {
    targets = [];
    if (ctx?.log) ctx.log(`[mobility] target search failed: ${error?.message || error}`);
  }
  const errands = toErrands(targets, cached?.errands || new Map());
  armed.set(position.trip_id, {
    searchedAt: { latitude: position.latitude, longitude: position.longitude },
    searchedAtMs: now,
    fingerprint,
    lastPosition: { latitude: position.latitude, longitude: position.longitude },
    errands,
  });
  return rank(errands, position);
}

/**
 * The flat target list, for callers that want places rather than decisions.
 * Every candidate of every errand — an errand pointed at one shop is still
 * WATCHING the others until it is locked.
 */
export async function ensureTripTargets(position, ctx, fetchFn = fetch, now = Date.now()) {
  const errands = await ensureTripPlan(position, ctx, fetchFn, now);
  return [...errands.values()].flatMap((errand) => errand.candidates);
}

/**
 * Settle an errand on the place the owner just accepted, and stop looking.
 *
 * Pressing "voy" is the strongest possible answer to "which of these shops?",
 * and it arrives from the chip handler long after the search that offered the
 * choice. Without this the next re-search would re-rank the errand and could
 * point it somewhere else while the driver is on their way to the first one.
 */
export function lockTripErrand(tripId, taskId, reason = "accepted") {
  const entry = armed.get(tripId);
  const errand = entry?.errands?.get(taskId);
  if (!errand) return false;
  errand.locked = true;
  errand.lock_reason = reason;
  return true;
}

/**
 * The errand a surface is pointing at, as an alert-shaped record.
 *
 * The phone's list offers the same four choices as the Telegram card, and
 * "voy" pressed there has to mean exactly what "voy" pressed in Telegram
 * means — same one-shot, same follow-up after the trip. So it resolves to the
 * same shape recordMobilityAlert() stores, rather than growing a second,
 * parallel notion of "the owner answered".
 */
export function tripErrand(tripId, taskId) {
  const errand = armed.get(tripId)?.errands?.get(taskId);
  if (!errand?.chosen) return null;
  return {
    ...errand.chosen,
    trip_id: tripId,
    task_id: errand.task_id,
    task: errand.task,
    project_id: errand.project_id,
  };
}

/**
 * Everything this trip is watching, for a surface that wants to SHOW it rather
 * than be interrupted by it — the phone's trip list. One row per errand, not
 * per place: the driver picks between errands, and the shop is the plan's
 * business. Each row says whether the owner has already been asked and what
 * they answered, so the list reads as state and not as a second round of
 * reminders.
 */
export function tripPlaces(tripId) {
  const entry = armed.get(tripId);
  if (!entry?.errands?.size) return [];
  const from = entry.lastPosition || entry.searchedAt;
  const destination = mobilityContext().trip?.destination || "";
  const answers = new Map(
    listMobilityAlerts()
      .filter((alert) => alert.trip_id === tripId)
      .map((alert) => [alert.task_id, alert])
  );
  return [...entry.errands.values()]
    .filter((errand) => errand.chosen)
    .map((errand) => {
      const alert = answers.get(errand.task_id);
      const chosen = errand.chosen;
      return {
        task_id: errand.task_id,
        task: errand.task,
        place: chosen.place,
        latitude: chosen.latitude,
        longitude: chosen.longitude,
        distance_m: Math.round(haversineMeters(from, chosen)),
        maps_url: navigateUrl(chosen),
        // Both links the Telegram card offers, so a surface reading this list
        // can present the same two choices without knowing how to build a
        // Maps URL. Without a destination the second degrades to plain
        // navigation — see addToRouteUrl.
        add_stop_url: addToRouteUrl(chosen, destination),
        // How many shops could still satisfy this errand. 1 means the choice
        // is made; more means the list is showing the nearest of several.
        options: errand.candidates.length,
        locked: Boolean(errand.locked),
        alerted: Boolean(alert),
        answer: alert?.answer || null,
      };
    })
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, MAX_LISTED_PLACES);
}

/**
 * The alerts this position newly earns — usually none. AT MOST ONE PER ERRAND:
 * a task that matches thirteen pharmacies gets the nearest one, not thirteen
 * cards. Candidates are returned un-recorded so the caller burns the one-shot
 * only on the ones it actually tries to deliver; recording every match here
 * silently spent reminders that were never sent.
 */
export async function evaluateMobilityPosition(position, ctx, fetchFn = fetch) {
  const errands = await ensureTripPlan(position, ctx, fetchFn);
  const due = [];
  for (const errand of errands.values()) {
    if (!errand.chosen) continue;
    if (mobilityAlertFired(position.trip_id, errand.task_id)) continue;
    const chosen = errand.chosen;
    const distance_m = chosen.distance_m ?? Math.round(haversineMeters(position, chosen));
    // A task may set its own idea of "there" — a pharmacy you would detour two
    // kilometres for is not a bakery you would only stop at if you were passing.
    if (distance_m > (chosen.radius_m || PROXIMITY_RADIUS_M)) continue;
    due.push({ ...chosen, trip_id: position.trip_id, distance_m });
  }
  // Nearest first: if two errands land on the same sample, the one you are
  // about to drive past is the one that matters.
  return due.sort((a, b) => a.distance_m - b.distance_m);
}

/** Google Maps deep link that starts turn-by-turn navigation to the place. */
export function navigateUrl(alert) {
  return `https://www.google.com/maps/dir/?api=1&destination=${alert.latitude},${alert.longitude}&travelmode=driving`;
}

/**
 * Google Maps deep link that keeps the current destination and inserts the
 * place as a stop along the way. Without a known destination there is no route
 * to add to, so it degrades to plain navigation rather than inventing one.
 */
export function addToRouteUrl(alert, destination = "") {
  const stop = `${alert.latitude},${alert.longitude}`;
  if (!destination) return navigateUrl(alert);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` +
    `&waypoints=${stop}&travelmode=driving`;
}

function distanceLabel(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

/** The reminder itself — one line of place, one line of errand. Read at 60 km/h. */
export function proximityMessage(alert, lang = "es") {
  return [
    `📍 ${t("mobility.near", { lang, vars: { place: alert.place, distance: distanceLabel(alert.distance_m) } })}`,
    alert.task ? `${t("mobility.task", { lang })}: ${alert.task}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * The chips. Two navigation links (which Telegram opens straight into Maps)
 * and two answers, because "do I detour for this?" is the only question the
 * driver actually has to answer right now. The follow-up — "did you get it?" —
 * is asked after the trip, from the answer recorded here.
 */
export function proximityKeyboard(alert, { destination = "", lang = "es" } = {}) {
  return {
    inline_keyboard: [
      [
        { text: `🧭 ${t("mobility.navigate", { lang })}`, url: navigateUrl(alert) },
        { text: `➕ ${t("mobility.add_stop", { lang })}`, url: addToRouteUrl(alert, destination) },
      ],
      [
        { text: `✅ ${t("mobility.going", { lang })}`, callback_data: `apx:mobility:go:${alert.id}` },
        { text: `❌ ${t("mobility.not_today", { lang })}`, callback_data: `apx:mobility:skip:${alert.id}` },
      ],
    ],
  };
}

/** The question asked once the driving is over, for every "voy" that went out. */
export function followupMessage(alert, lang = "es") {
  const question = t("mobility.followup", { lang, vars: { place: alert.place } });
  return alert.task ? `${question}\n${t("mobility.task", { lang })}: ${alert.task}` : question;
}

export function followupKeyboard(alert, lang = "es") {
  return {
    inline_keyboard: [
      [
        { text: `✅ ${t("mobility.done", { lang })}`, callback_data: `apx:mobility:done:${alert.id}` },
        { text: `🕓 ${t("mobility.still_open", { lang })}`, callback_data: `apx:mobility:open:${alert.id}` },
      ],
    ],
  };
}

/** Drop a finished trip's plan. Called when the trip ends. */
export function releaseTripTargets(tripId) {
  armed.delete(tripId);
}

export function _resetMobilityGeofencesForTest() {
  armed.clear();
}
