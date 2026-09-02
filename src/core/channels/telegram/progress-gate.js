// One notice, then the work, then the answer — the message budget for a
// Telegram turn.
//
// Tool-start activity is now shown directly by reply.js, because a Telegram
// owner asked to see every real action. This gate only controls OPTIONAL model
// prose around those actions, so a model that narrates every step cannot double
// every activity line with another push notification.
//
// So this gate decides which stream events become chat messages:
//
//   - The FIRST line the model writes goes out as an optional turn opener.
//     A tool-start activity line still appears even if the model skips prose.
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
