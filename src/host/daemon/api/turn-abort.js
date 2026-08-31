// The two halves of "the user stopped this turn", shared by the chat routes so
// the project-agent stream and the super-agent stream agree on what an
// interruption looks like.
//
// It is a normal outcome, not a failure. A turn that was interrupted has
// usually done real work the user watched happen, and the whole point of
// interrupting (rather than waiting) is to redirect that work with a new
// message — so the partial has to survive into the thread, and the client has
// to be able to tell "you stopped this" apart from "this broke".

/**
 * Was this throw the abort we asked for, rather than a real failure?
 *
 * Checked against OUR controller, not just the error: an engine that aborts its
 * own fetch on a timeout also throws AbortError, and treating that as "the user
 * stopped it" would swallow a genuine failure and show the user a turn they
 * never interrupted.
 *
 * @param {unknown} e the thrown value
 * @param {AbortController} controller the turn's own controller
 */
export function wasAborted(e, controller) {
  if (!controller?.signal?.aborted) return false;
  return e?.name === "AbortError" || /abort/i.test(String(e?.message || ""));
}

/**
 * The terminal stream event for an interrupted turn. Deliberately NOT `error`:
 * a client that renders errors as a red banner would accuse the daemon of
 * breaking every time the user pressed stop.
 */
export function abortedTurnEvent({ text = "", trace = [] } = {}) {
  return { type: "aborted", result: { text, trace } };
}
