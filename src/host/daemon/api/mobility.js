import {
  acceptMobilityEvent,
  dispatchMobilityEvent,
  dispatchMobilityPosition,
} from "#core/mobility/trip-event.js";
import { acceptMobilityPosition, lockTripErrand, tripErrand, tripPlaces } from "#core/mobility/geofence.js";
import { answerMobilityAlert, MOBILITY_ANSWERS } from "#core/mobility/answer.js";
import { doneTask } from "#core/stores/tasks.js";
import { resolveLang } from "#core/i18n/index.js";
import {
  listMobilityAlerts,
  mobilityContext,
  recordMobilityAlert,
  updateMobilityAlert,
} from "#core/mobility/state.js";

/**
 * Close the task a proximity alert was about.
 *
 * The daemon's half of core/mobility/answer.js: the alert records WHICH project
 * the task came from, so this resolves that one project rather than searching
 * every registered one — two projects can hold tasks whose short ids share a
 * prefix. Mirrors closeAlertTask() in the Telegram adapter, which does the same
 * thing with the plugin's own registry handle.
 */
function closeAlertTaskFor(ctx, alert) {
  if (!alert?.task_id) return false;
  let storagePath = null;
  try {
    storagePath = ctx.projects?.get(alert.project_id)?.storagePath || null;
  } catch {
    storagePath = null;
  }
  if (!storagePath) return false;
  try {
    return Boolean(doneTask(storagePath, alert.task_id, "mobility"));
  } catch (error) {
    console.warn(`[mobility] could not close task ${alert.task_id}: ${error.message}`);
    return false;
  }
}

export function register(api, ctx) {
  // What the phone's trip banner shows when it is tapped: the current trip and
  // the errands APX is watching for on it. Read-only and deliberately separate
  // from the alert path — a driver looking at the list is not being
  // interrupted by it, so nothing here fires a reminder or spends a one-shot.
  api.get("/mobility/trip", (req, res) => {
    const state = mobilityContext();
    const trip = state.trip?.active ? state.trip : null;
    res.json({
      trip,
      places: trip ? tripPlaces(trip.trip_id) : [],
    });
  });

  // A button on the NATIVE card — the phone's notification, or the head unit.
  //
  // This is the other half of the alert no longer depending on Telegram: the
  // card is pushed over the events socket (core/events/bus.js) and answered
  // here, so a install with no Telegram plugin has a complete round trip.
  // `navigate` and `add_stop` land on the same branch as "voy": the driver did
  // not promise to go, they started going.
  api.post("/mobility/alerts/:id/answer", (req, res) => {
    const action = String(req.body?.action || "").trim();
    if (!MOBILITY_ANSWERS.includes(action)) {
      return res.status(400).json({ error: `action must be one of ${MOBILITY_ANSWERS.join(", ")}` });
    }
    const result = answerMobilityAlert(req.params.id, action, {
      lang: resolveLang(ctx.config),
      // Closing the task needs the project registry, which core does not have.
      closeTask: (alert) => closeAlertTaskFor(ctx, alert),
    });
    if (!result.ok) {
      return res.status(result.reason === "unknown-alert" ? 404 : 400).json({ error: result.reason });
    }
    res.json({ ok: true, ack: result.ack, alert: result.alert });
  });

  // "Voy" / "Hoy no" pressed on the phone's own list instead of on the
  // Telegram card. Same answer, same record, same follow-up after the trip —
  // the surface is different, the promise is not. Answering here also burns
  // the one-shot, which is the point: the owner has already decided, so the
  // proximity alert for that errand has nothing left to ask.
  api.post("/mobility/errands/answer", (req, res) => {
    const state = mobilityContext();
    const trip = state.trip?.active ? state.trip : null;
    if (!trip) return res.status(409).json({ error: "no trip is running" });
    const taskId = String(req.body?.task_id || "").trim();
    const answer = String(req.body?.answer || "").trim();
    if (!taskId) return res.status(400).json({ error: "task_id required" });
    // "next" is the phone's half of «avisar en la siguiente»: same three
    // answers the Telegram card offers, because the docs promise the two
    // surfaces ask the same question. "skip" stays for the older APK.
    if (answer !== "go" && answer !== "skip" && answer !== "next") {
      return res.status(400).json({ error: "answer must be go, next or skip" });
    }

    const existing = listMobilityAlerts()
      .filter((alert) => alert.trip_id === trip.trip_id && alert.task_id === taskId)
      .pop();
    // No alert yet means the owner is answering BEFORE being asked — reading
    // the list and deciding on their own. That still deserves a record, or the
    // decision would be forgotten the moment the reminder fired anyway.
    const alert = existing || (() => {
      const errand = tripErrand(trip.trip_id, taskId);
      return errand ? recordMobilityAlert(errand) : null;
    })();
    if (!alert) return res.status(404).json({ error: "that errand is not on this trip" });

    const answered_at = new Date().toISOString();
    // "next" declines the PLACE: the errand stops counting as announced, so a
    // different shop can raise it again later in the drive, and the outcome
    // closes it for the after-trip follow-up — nothing was promised here.
    // "skip" is still the whole errand, for the rest of the trip.
    const patch = {
      go: { answer: "go", answered_at },
      next: { answer: "next", answered_at, outcome: "skipped_place" },
      skip: { answer: "skip", answered_at, outcome: "skipped" },
    }[answer];
    updateMobilityAlert(alert.id, patch);
    if (answer === "go") lockTripErrand(trip.trip_id, taskId, "accepted");
    res.json({ ok: true, alert_id: alert.id, answer });
  });

  api.post("/mobility/events", (req, res) => {
    let event;
    try {
      event = acceptMobilityEvent(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (event.duplicate) return res.json({ accepted: true, duplicate: true, event_id: event.event_id });
    res.status(202).json({ accepted: true, event_id: event.event_id });
    const dispatch = ctx.mobilityDispatch || dispatchMobilityEvent;
    setImmediate(() => {
      Promise.resolve(dispatch(event, ctx)).catch((error) => {
        console.error(`[mobility] ${error?.message || error}`);
      });
    });
  });

  // The live GPS stream while a trip is running. Answered before any work for
  // the same reason the event route is: the phone is on mobile data in a
  // moving car, and a request it has to hold open until a place search and a
  // Telegram send have finished is a request that times out. Proximity is
  // evaluated after the ack, and the one-alert-per-place guarantee lives in
  // core/mobility/geofence.js, not here.
  api.post("/mobility/positions", (req, res) => {
    let position;
    try {
      position = acceptMobilityPosition(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    res.status(202).json({ accepted: true, trip_id: position.trip_id });
    const dispatch = ctx.mobilityPositionDispatch || dispatchMobilityPosition;
    setImmediate(() => {
      Promise.resolve(dispatch(position, ctx)).catch((error) => {
        console.error(`[mobility] ${error?.message || error}`);
      });
    });
  });
}
