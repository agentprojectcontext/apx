// A ceiling on ONE tool call, and a way out of one that is taking too long.
//
// WHAT WAS WRONG. The loop ran tools as `toolResult = await handler(args)` — a
// bare await, with nothing else in the race. Two defects lived in that line.
//
// STOP DID NOT REACH A RUNNING TOOL. The abort signal was only read between
// iterations, so pressing Stop during a ten-minute `run_shell` did nothing
// until the command came back on its own. Every surface's cancel button had
// this hole in it.
//
// AND A HANDLER THAT NEVER SETTLES TOOK THE TURN WITH IT, forever, with the
// daemon up and reporting healthy. Not hypothetical: `run_shell` did exactly
// this whenever a spawn failed, which on Windows is every single call. Its own
// timeout could not help (a timeout that signals a process still has to hear
// `close` back) and neither could Stop. That root cause is fixed in
// run-shell.js and core/util/shell.js — but "all hundred-odd handlers always
// settle" is not a property anybody can maintain by hand when they spawn
// processes, hold sockets and run nested agent turns. This is the floor under
// the next one.
//
// TWO MARKS, AND THEY DO DIFFERENT JOBS.
//
//   SLOW (60 s) is the one that answers the actual complaint. It changes
//   nothing about the run — it emits an event, which the live feed and the CLI
//   spinner already know how to render, so a call that is taking minutes SAYS
//   so instead of looking like a frozen chat. Most of the value is here, and it
//   costs nothing: a slow tool is not a broken tool.
//
//   DEADLINE (15 min by default) is the ceiling. It is deliberately far past
//   anything a working tool does, because the cost of firing early — telling
//   the model a call failed while it is quietly succeeding, which for a
//   side-effecting tool means doing it twice — is worse than the cost of
//   waiting a few extra minutes for a genuine hang. A tool that legitimately
//   runs longer declares its own (see `deadlineMs` on run_shell), derived from
//   the ceiling it already enforces so the two cannot disagree.
//
// WHAT THE DEADLINE CANNOT DO is stop the work. There is no handle here — the
// handler owns its process, its socket, its nested turn. So the result says
// exactly that rather than implying the call was cancelled: an honest "it is
// still running and nobody is waiting for it any more" is something the model
// can reason about, and "it failed" is not.
//
// ABORT is the third racer and the reason Stop now works mid-tool. It does not
// return a result — it throws, because an aborted turn is not a turn with one
// failed step in it. run-agent re-raises AbortError rather than folding it into
// a tool error, so the existing abort path handles it as it always did.

/** When a call stops looking normal and starts looking stuck. Emitted, not
 *  enforced — nothing about the run changes at this mark. */
export const TOOL_SLOW_WARN_MS = 60_000;

/** When waiting stops being worth it. See the header for why it is this far
 *  out. Override per tool with a `deadlineMs` on the handler. */
export const TOOL_DEADLINE_MS = 15 * 60_000;

/**
 * The deadline for one call.
 *
 * A handler declares `deadlineMs` as a number, or as a function of the call's
 * own arguments — `run_shell` waits 60 s or 600 s depending on what it was
 * asked for, and a fixed number would have to be the larger of the two for
 * every call.
 *
 * A declaration that throws or returns nonsense falls back to the default
 * rather than taking the turn down with it: this is the safety net, and a
 * safety net whose own arithmetic can crash the thing it protects is worse
 * than none.
 */
export function resolveToolDeadline(handler, args) {
  const declared = handler?.deadlineMs;
  try {
    const raw = typeof declared === "function" ? declared(args || {}) : declared;
    const ms = Number(raw);
    if (Number.isFinite(ms) && ms > 0) return ms;
  } catch {
    // fall through
  }
  return TOOL_DEADLINE_MS;
}

/**
 * Run one tool call under a watchdog.
 *
 * @param {() => Promise<any>} run       the bound handler call
 * @param {object}   o
 * @param {string}   o.name              tool name, for the event and the message
 * @param {number}   o.deadlineMs
 * @param {number}   [o.slowMs]
 * @param {AbortSignal} [o.signal]
 * @param {(info: object) => any} [o.onSlow]  called once, at the slow mark
 * @returns {Promise<any>} the handler's own result, or a shaped error object
 *          when the deadline passes first.
 * @throws  the handler's own rejection, or an AbortError when the signal fires.
 */
export async function runToolWithWatchdog(run, { name, deadlineMs, slowMs = TOOL_SLOW_WARN_MS, signal, onSlow } = {}) {
  const startedAt = Date.now();
  const deadline = Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : TOOL_DEADLINE_MS;

  let slowTimer = null;
  let deadlineTimer = null;
  let onAbort = null;

  const clear = () => {
    if (slowTimer) clearTimeout(slowTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (onAbort && signal) signal.removeEventListener("abort", onAbort);
  };

  // The handler's promise is raced, so when another racer wins this one is left
  // in flight. Without a catch attached, a handler that rejects AFTER the
  // deadline becomes an unhandled rejection — in the daemon that is a logged
  // stack trace for a call nobody is waiting on any more, and in tests it is a
  // failure in whatever runs next.
  const work = Promise.resolve()
    .then(run)
    .then(
      (value) => ({ kind: "result", value }),
      (error) => ({ kind: "threw", error })
    );

  const slow = new Promise((resolve) => {
    // Only arm the warning when the deadline is far enough out for it to mean
    // anything. A tool that is allowed 30 s does not need to be reported slow
    // at 60.
    if (!Number.isFinite(slowMs) || slowMs <= 0 || slowMs >= deadline) return;
    slowTimer = setTimeout(() => resolve({ kind: "slow" }), slowMs);
    slowTimer.unref?.();
  });

  const expired = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => resolve({ kind: "deadline" }), deadline);
    deadlineTimer.unref?.();
  });

  const aborted = new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) return resolve({ kind: "aborted" });
    onAbort = () => resolve({ kind: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
  });

  // The slow mark is not an outcome — it fires, reports, and the race carries
  // on with the remaining three. Looping rather than nesting keeps that
  // explicit; at most one extra pass ever happens.
  let outcome = await Promise.race([work, slow, expired, aborted]);
  if (outcome.kind === "slow") {
    try {
      await onSlow?.({ tool: name, elapsed_ms: Date.now() - startedAt, deadline_ms: deadline });
    } catch {
      // A reporting failure must not become a tool failure.
    }
    outcome = await Promise.race([work, expired, aborted]);
  }

  clear();

  if (outcome.kind === "result") return outcome.value;
  if (outcome.kind === "threw") throw outcome.error;
  if (outcome.kind === "aborted") {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }

  const waited = Math.round((Date.now() - startedAt) / 1000);
  return {
    error:
      `${name} did not answer within ${waited}s and this turn stopped waiting for it. ` +
      `IT WAS NOT CANCELLED — whatever it started may still be running, and may still ` +
      `succeed, so do not simply repeat it: check whether the work happened before trying ` +
      `again, and tell the owner that this step is in an unknown state.`,
    timed_out: true,
    waited_s: waited,
  };
}
