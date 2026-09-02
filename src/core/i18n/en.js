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
};
