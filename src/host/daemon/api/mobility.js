import {
  acceptMobilityEvent,
  dispatchMobilityEvent,
} from "#core/mobility/trip-event.js";

export function register(api, ctx) {
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
}
