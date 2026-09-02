// The two halves of "the user stopped this turn", shared by the chat routes so
// the project-agent stream and the super-agent stream agree on what an
// interruption looks like.
//
// It is a normal outcome, not a failure. A turn that was interrupted has
// usually done real work the user watched happen, and the whole point of
// interrupting (rather than waiting) is to redirect that work with a new
// message — so the partial has to survive into the thread, and the client has
// to be able to tell "you stopped this" apart from "this broke".

// `wasAborted` moved to core when the group cascade needed the same test and
// core/ cannot import from host/ (rule 8). Re-exported here because this module
// is where every route already asks the question.
export { wasAborted } from "#core/agent/abort.js";

/**
 * The terminal stream event for an interrupted turn. Deliberately NOT `error`:
 * a client that renders errors as a red banner would accuse the daemon of
 * breaking every time the user pressed stop.
 */
export function abortedTurnEvent({ text = "", trace = [] } = {}) {
  return { type: "aborted", result: { text, trace } };
}
