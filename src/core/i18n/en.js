// Backend strings — English (en). This is also the default fallback locale.
export default {
  // Floors, not copy: the model writes the ack and the closing itself
  // (core/agent/author-line.js); these go out only when it couldn't. The two
  // `reply.*` ones are every surface's floor, not just Telegram's — see
  // core/agent/closing-floor.js.
  "telegram.reset_ack": "Done, context cleared. Starting fresh. What do you need?",
  "reply.fallback_done": "Done.",
  "reply.fallback_continue": "Made some headway. Want me to keep going?",
  // Host-emitted error floors (the model itself failed, so it can't author
  // these — they stay templated, but at least follow the user's language).
  "telegram.error_agent": "⚠️ The agent hit an error ({error}).",
  "telegram.error_generic": "⚠️ Couldn't reply right now ({error}).",
  // Mobility — the buttons and one-line reminders the DAEMON sends while a trip
  // is running (core/mobility/geofence.js). Host-emitted, not model-authored:
  // a driver reads these at a glance, so they stay fixed and short.
  "mobility.near": "You're near {place}, {distance} away.",
  "mobility.near_bare": "You're {distance} away.",
  "mobility.unit_m": "metres",
  "mobility.unit_km": "kilometres",
  "mobility.task": "Task",
  "mobility.address": "Address",
  // The native card's four answers, in the order they are offered. No emoji:
  // Android Auto hands the card to Assistant, which reads it out loud.
  "mobility.navigate": "Navigate now",
  "mobility.add_stop": "Add to route",
  "mobility.later": "Later",
  "mobility.dismiss": "Not now",
  "mobility.ack_dismissed": "Fine — nothing more about this one on this trip.",
  "mobility.going": "I'll go",
  "mobility.not_today": "Not today",
  "mobility.alert_next": "Tell me at the next one",
  "mobility.followup": "Did you make it to {place}?",
  "mobility.done": "Done",
  "mobility.still_open": "Not yet",
  "mobility.ack_going": "Noted — you're going.",
  "mobility.ack_skipped": "Fine, not today.",
  "mobility.ack_next": "Fine, I'll tell you at the next one.",
  "mobility.ack_done": "Closed the task.",
  "mobility.ack_still_open": "Leaving it open.",
  "mobility.transcript": "[Transcript]",
};
