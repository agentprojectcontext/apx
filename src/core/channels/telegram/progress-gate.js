// One notice, then the work, then the answer — the message budget for a
// Telegram turn.
//
// Model prose is the ONLY thing Telegram ever receives mid-turn: tool names are
// not sent (see reply.js), so this gate is not trimming a second channel of
// activity — it is the whole of what the owner sees between "on it" and the
// answer. That is why it opens rather than staying shut: hold the first line too
// and a turn that takes four minutes of tool work looks like nothing happened.
//
// So this gate decides which stream events become chat messages:
//
//   - The FIRST line the model writes goes out as the turn opener. A turn whose
//     model skips prose entirely and dives straight into tools stays silent —
//     the typing indicator carries it, and nothing is invented on the agent's
//     behalf.
//   - Everything after it is held. The turn goes quiet — the typing indicator
//     keeps ticking (poller._startTyping re-pings every 4s) — until the closing
//     message the caller always sends.
//   - Except on a long job: after `everyMs` of silence ONE more note is let
//     through, so a four-minute turn still shows a sign of life instead of
//     looking hung. `everyMs: 0` turns that off — strictly notice, work, answer.
//
// What is NOT gated here: the final reply. sendFinalReply always speaks, and
// the never-silent floor still applies — a turn can lose its progress notes,
// never its conclusion.
//
// Pure and clock-injectable: no I/O, no globals. The caller sends and logs.

/** Seconds of silence before one more progress note is allowed through. */
export const DEFAULT_PROGRESS_EVERY_S = 90;

/**
 * Read the knob: `super_agent.telegram_progress_every_s`.
 * Unset → the built-in default. 0 (or anything unusable) → no mid-turn notes.
 * @returns {number} milliseconds; 0 means "opening notice and closing only"
 */
export function progressEveryMs(globalConfig) {
  const raw = globalConfig?.super_agent?.telegram_progress_every_s;
  const secs = raw === undefined || raw === null || raw === "" ? DEFAULT_PROGRESS_EVERY_S : Number(raw);
  if (!Number.isFinite(secs) || secs <= 0) return 0;
  return Math.round(secs * 1000);
}

/**
 * @param {{everyMs?: number, now?: () => number}} opts
 * @returns {{ text: () => "send"|"hold", sinceLastMs: () => number }}
 */
export function createProgressGate({ everyMs = 0, now = Date.now } = {}) {
  let opened = false;
  let lastSentAt = 0;
  const markSent = () => {
    opened = true;
    lastSentAt = now();
  };
  return {
    /**
     * The model produced a text segment ahead of its tool calls.
     * "send" → it's the opening notice, or the heartbeat is due.
     */
    text() {
      if (!opened) {
        markSent();
        return "send";
      }
      if (everyMs > 0 && now() - lastSentAt >= everyMs) {
        markSent();
        return "send";
      }
      return "hold";
    },
    /** Milliseconds since the last message we let through (for logging). */
    sinceLastMs() {
      return opened ? now() - lastSentAt : 0;
    },
  };
}
