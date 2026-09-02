// What KIND of thing a task is — orthogonal to `state` (open/done/dropped),
// to `status` (pending/running/…), and to `tags`.
//
// Tags stay exactly what they were: free-form labels the owner invents. A
// category is a closed set the SYSTEM can act on, which is the whole point:
// "this is an errand, at this place" is a fact the daemon can route on without
// asking a model to read the title and guess. That guess is what a category
// replaces — a mobility reminder for a categorised task costs no geocoding,
// no place search and no LLM call.
//
// Registry pattern (AGENTS.md): adding a category is one entry here plus its
// two i18n keys. Nothing else switches on the id.
export const TASK_CATEGORIES = Object.freeze({
  // The default. A task that is just a task.
  general: Object.freeze({ id: "general", icon: "circle-dot", locatable: false }),
  // Something to do while out — an errand with a place. `locatable` is what
  // makes the mobility geofence consider it, and what makes the web offer the
  // place fields.
  trip: Object.freeze({ id: "trip", icon: "car", locatable: true }),
});

export const TASK_CATEGORY_IDS = Object.freeze(Object.keys(TASK_CATEGORIES));
export const DEFAULT_TASK_CATEGORY = "general";

/** Unknown or missing → the default. Never throws: this reads stored data. */
export function normalizeTaskCategory(value) {
  const id = String(value || "").trim().toLowerCase();
  return TASK_CATEGORY_IDS.includes(id) ? id : DEFAULT_TASK_CATEGORY;
}

/** Can a task of this category carry a place? */
export function categoryIsLocatable(value) {
  return TASK_CATEGORIES[normalizeTaskCategory(value)].locatable === true;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * A task's place, normalized. Returns null when there is nothing usable —
 * a half-filled location is worse than none, because everything downstream
 * would treat it as an answer.
 *
 * `place` alone is valid: it names somewhere without pinning it, which is
 * still enough for a reminder to be worth reading. Coordinates are only kept
 * as a pair, and only when both are in range.
 */
export function normalizeTaskLocation(value) {
  if (!value || typeof value !== "object") return null;
  const place = text(value.place ?? value.name, 200);
  const address = text(value.address, 300);
  const latitude = finite(value.latitude ?? value.lat);
  const longitude = finite(value.longitude ?? value.lon ?? value.lng);
  const pinned =
    latitude != null && longitude != null &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180;
  if (!place && !address && !pinned) return null;
  return {
    ...(place ? { place } : {}),
    ...(address ? { address } : {}),
    ...(pinned ? { latitude, longitude } : {}),
    // How close counts as "there". Absent means the caller had no opinion and
    // the mobility default applies.
    ...(finite(value.radius_m) != null ? { radius_m: finite(value.radius_m) } : {}),
  };
}
