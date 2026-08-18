// One notice, then the work, then the answer — the message budget for a
// Telegram turn.
//
// The super-agent gets 24 tool steps on this channel (TELEGRAM_TOOL_ITERS), and
// the two-segment discipline has it write a short line before each one ("Reviso
// eso", "Busco el archivo"). Streaming every one of those turned a single
// request into eight chat messages — eight push notifications on a phone for
// one task. The information was real; the delivery was spam.
//
// So this gate decides which stream events become chat messages:
//
//   - The FIRST line the model writes goes out as the turn's one notice. The
//     two-segment discipline has it write that line before the first tool, so
//     it lands before the work starts. Nothing is ever sent on the agent's
//     behalf: a turn that opens straight into a tool stays quiet until the
//     model itself speaks.
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
