import {
  acceptMobilityEvent,
  dispatchMobilityEvent,
  dispatchMobilityPosition,
} from "#core/mobility/trip-event.js";
import { acceptMobilityPosition, tripPlaces } from "#core/mobility/geofence.js";
import { mobilityContext } from "#core/mobility/state.js";

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
