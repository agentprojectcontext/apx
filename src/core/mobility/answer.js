// What a proximity answer DOES, in one place.
//
// It used to live inside the Telegram callback handler, which was the only
// surface that could answer. Now the phone and the head unit can too, and the
// same tap has to mean the same thing wherever it lands — an answer that
// records a promise on Telegram and merely dismisses a notification in the car
// is two features wearing one name.
//
// Closing the task is NOT here. It needs the daemon's project registry to
// resolve which project the task lives in, and core does not import the daemon
// (AGENTS.md rule 8: core is the home, adapters supply what only they have).
// The caller passes it in.
import { t } from "#core/i18n/index.js";
import { lockTripErrand } from "./geofence.js";
import { getMobilityAlert, recordMobilityResponse, updateMobilityAlert } from "./state.js";

/** Every answer a card can carry, on any surface. */
export const MOBILITY_ANSWERS = Object.freeze([
  // While driving.
  "navigate", "add_stop", "go", "next", "skip",
  // After the trip, from the follow-up.
  "done", "open",
]);

/**
 * Apply one answer to one alert.
 *
 * @param {string} alertId
 * @param {string} action              one of MOBILITY_ANSWERS
 * @param {object} [opts]
 * @param {string} [opts.lang]
 * @param {(alert: object) => boolean} [opts.closeTask]
 *        Closes the task an alert was about. Only `done` uses it; omit it and
 *        `done` records the answer without touching the task.
 * @returns {{ok: boolean, ack: string, reason?: string, alert?: object}}
 */
export function answerMobilityAlert(alertId, action, { lang = "es", closeTask = null } = {}) {
  const alert = getMobilityAlert(alertId);
  if (!alert) return { ok: false, ack: "", reason: "unknown-alert" };
  if (!MOBILITY_ANSWERS.includes(action)) return { ok: false, ack: "", reason: "unknown-action" };

  const now = new Date().toISOString();
  let ack = "";

  // NAVIGATE and ADD_STOP are "voy" in its most committed form: the driver did
  // not say they would go, they started going. On Telegram those two are URL
  // chips that cannot report a tap, which is why "go" exists as its own answer
  // there — here they land on the same branch, so the end-of-trip follow-up
  // asks about them exactly as it does about a promise.
  if (action === "navigate" || action === "add_stop" || action === "go") {
    updateMobilityAlert(alert.id, { answer: "go", answered_at: now });
    // The last word on WHICH shop: settle the errand there so a later
    // re-search cannot re-point it at another branch mid-drive.
    lockTripErrand(alert.trip_id, alert.task_id, "accepted");
    ack = t("mobility.ack_going", { lang });
  } else if (action === "next") {
    // "Not this branch" — not "forget it". The record keeps the place it named
    // so the geofence knows which shop to stop offering, and `answer: "next"`
    // is what stops this errand counting as announced.
    updateMobilityAlert(alert.id, { answer: "next", answered_at: now, outcome: "skipped_place" });
    ack = t("mobility.ack_next", { lang });
  } else if (action === "skip") {
    // The whole errand goes quiet for the trip. Nothing else is needed to make
    // that stick: mobilityAlertFired() counts any answer other than "next" as
    // announced, so the question comes back on the next drive, not in ten
    // blocks. This is the card's "No ahora".
    updateMobilityAlert(alert.id, { answer: "skip", answered_at: now, outcome: "skipped" });
    ack = t("mobility.ack_dismissed", { lang });
  } else if (action === "done") {
    const closed = closeTask ? closeTask(alert) : false;
    updateMobilityAlert(alert.id, { outcome: closed ? "done" : "done_unlinked" });
    ack = t("mobility.ack_done", { lang });
  } else if (action === "open") {
    updateMobilityAlert(alert.id, { outcome: "still_open" });
    ack = t("mobility.ack_still_open", { lang });
  }

  recordMobilityResponse(action);
  return { ok: true, ack, alert: getMobilityAlert(alert.id) };
}
