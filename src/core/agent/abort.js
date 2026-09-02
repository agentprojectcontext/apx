// "Was this throw the abort we asked for?" — the one home for that question.
//
// It lives in core because both sides of a stopped turn need it: the daemon
// routes that own the AbortController (host/daemon/api/*), and the group cascade
// (agent/group/run-group-turn.js), which has to tell "the owner pressed Stop"
// apart from "this speaker's model fell over" while deciding whether to persist
// the partial and end the room's turn quietly. core/ cannot import from host/,
// so a second copy was the alternative.
//
// Checked against OUR controller, not just the error: an engine that aborts its
// own fetch on a timeout also throws AbortError, and treating that as "the user
// stopped it" would swallow a genuine failure and show the user a turn they
// never interrupted.
//
// @param {unknown} e the thrown value
// @param {{signal?: AbortSignal}|AbortController|null} controller the turn's own controller
export function wasAborted(e, controller) {
  if (!controller?.signal?.aborted) return false;
  return e?.name === "AbortError" || /abort/i.test(String(e?.message || ""));
}

/** Same question, when all you were handed is the signal itself. */
export function wasAbortedBySignal(e, signal) {
  return wasAborted(e, signal ? { signal } : null);
}
