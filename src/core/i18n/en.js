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
  "mobility.near": "You're near {place} ({distance}).",
  "mobility.task": "Task",
  "mobility.navigate": "Navigate",
  "mobility.add_stop": "Add stop",
  "mobility.going": "I'll go",
  "mobility.not_today": "Not today",
  "mobility.followup": "Did you make it to {place}?",
  "mobility.done": "Done",
  "mobility.still_open": "Not yet",
  "mobility.ack_going": "Noted — you're going.",
  "mobility.ack_skipped": "Fine, not today.",
  "mobility.ack_done": "Closed the task.",
  "mobility.ack_still_open": "Leaving it open.",
  "mobility.transcript": "📝 Transcript of the voice note",
};
