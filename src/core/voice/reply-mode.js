// Whether a reply goes out spoken as well as written, and who gets to decide.
//
// Three answers, in order of who wins:
//
//   1. What the owner asked for in this conversation, out loud, mid-turn
//      ("mandame audio" / "ahora mandá texto"). Held in memory, per thread,
//      until the daemon restarts — "for now" is what asking mid-conversation
//      means, and a preference that outlives the conversation is what the
//      settings toggle is for.
//   2. Driving. A trip overrides both of the above in the other direction:
//      the point of spoken replies at the wheel is that you cannot safely
//      reach the phone to turn them on.
//   3. `voice.voice_replies` in config — the standing preference, off unless
//      set, so upgrading does not start talking at anybody.
//
// This is delivery, not length. Driving also puts the turn in voice MODE, which
// makes the model write two short sentences; this does not, and deliberately:
// asked for outside a car, "read me the first part" is not the same request as
// "answer me in two sentences". The full reply still arrives as text.

const overrides = new Map();   // thread key -> boolean

/** Remember what the owner just asked for, for this thread. */
export function setVoiceReplyOverride(key, on) {
  if (!key) return;
  overrides.set(String(key), Boolean(on));
}

/** Forget it — back to the configured default. */
export function clearVoiceReplyOverride(key) {
  if (key) overrides.delete(String(key));
}

/** What the owner asked for here, or undefined if they never said. */
export function voiceReplyOverride(key) {
  return key ? overrides.get(String(key)) : undefined;
}

/** The standing preference. Off unless configured. */
export function voiceRepliesConfigured(globalConfig) {
  return globalConfig?.voice?.voice_replies === true;
}

/**
 * Should this reply be spoken? `driving` comes from the caller because only it
 * knows whether trip state applies to this channel.
 */
export function voiceRepliesActive(globalConfig, { key, driving = false } = {}) {
  const asked = voiceReplyOverride(key);
  if (asked !== undefined) return asked;
  if (driving) return true;
  return voiceRepliesConfigured(globalConfig);
}

/** Exposed for tests — the overrides are process state, not a store. */
export function _resetVoiceReplyOverrides() {
  overrides.clear();
}
