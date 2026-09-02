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
import { t } from "#core/i18n/index.js";
import { activeTasks, haversineMeters, nearbyPois, taskNeeds } from "./osm-route.js";
import { mobilityAlertFired } from "./state.js";

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

// Per-trip targets, held in memory. Deliberately NOT persisted: they are a
// derived cache (rebuilt from tasks + a place search in one call), while the
// thing that must survive a restart — which reminders were already delivered —
// lives in ./state.js. Two lifetimes, two homes.
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
  const rows = activeTasks(ctx.projects)
    .map((task) => ({ task, needs: taskNeeds(task) }))
    .filter((row) => row.needs.length);
  if (!rows.length) return [];

  const needs = [...new Map(
    rows.flatMap((row) => row.needs).map((need) => [`${need.id}:${need.query}`, need])
  ).values()];
  const places = await nearbyPois(
    { points: [{ latitude: position.latitude, longitude: position.longitude }] },
    needs,
    fetchFn,
    { padDegrees: SEARCH_PAD_DEGREES }
  );

  const targets = [];
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
 * Targets for this trip, searched at most once per RETARGET_DISTANCE_M of
 * travel. A search failure caches an empty set on purpose: the alternative is
 * retrying a dead endpoint on every GPS sample for the rest of the drive.
 */
export async function ensureTripTargets(position, ctx, fetchFn = fetch) {
  const cached = armed.get(position.trip_id);
  if (cached && haversineMeters(cached.searchedAt, position) < RETARGET_DISTANCE_M) {
    return cached.targets;
  }
  let targets = [];
  try {
    targets = await buildTripTargets(position, ctx, fetchFn);
  } catch (error) {
    targets = [];
    if (ctx?.log) ctx.log(`[mobility] target search failed: ${error?.message || error}`);
  }
  armed.set(position.trip_id, {
    searchedAt: { latitude: position.latitude, longitude: position.longitude },
    targets,
  });
  return targets;
}

/**
 * The alerts this position newly earns — usually none. AT MOST ONE PER ERRAND:
 * a task that matches thirteen pharmacies gets the nearest one, not thirteen
 * cards. Candidates are returned un-recorded so the caller burns the one-shot
 * only on the ones it actually tries to deliver; recording every match here
 * silently spent reminders that were never sent.
 */
export async function evaluateMobilityPosition(position, ctx, fetchFn = fetch) {
  const targets = await ensureTripTargets(position, ctx, fetchFn);
  const nearestPerTask = new Map();
  for (const target of targets) {
    if (mobilityAlertFired(position.trip_id, target.task_id)) continue;
    const distance_m = Math.round(haversineMeters(position, target));
    if (distance_m > PROXIMITY_RADIUS_M) continue;
    const best = nearestPerTask.get(target.task_id);
    if (best && best.distance_m <= distance_m) continue;
    nearestPerTask.set(target.task_id, { ...target, trip_id: position.trip_id, distance_m });
  }
  // Nearest first: if two errands land on the same sample, the one you are
  // about to drive past is the one that matters.
  return [...nearestPerTask.values()].sort((a, b) => a.distance_m - b.distance_m);
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

/** Drop a finished trip's target cache. Called when the trip ends. */
export function releaseTripTargets(tripId) {
  armed.delete(tripId);
}

export function _resetMobilityGeofencesForTest() {
  armed.clear();
}
