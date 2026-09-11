// How long a shutdown is allowed to take, in one place.
//
// Three numbers that MUST stay ordered, across two processes that never import
// each other's code: the daemon drains, then aborts what is left, and the CLI
// waits for the port. Get the order wrong and the symptom is not a timeout —
// it is the daemon being shot in the middle of the work this drain exists to
// protect, or `apx restart` declaring failure over a daemon that was about to
// exit cleanly.
//
//   DRAIN_MS  ─────────┐
//   + SETTLE_MS ───────┤ < SHUTDOWN_GRACE_MS < PORT_RELEASE_WAIT_MS
//
// They live in core/ because the daemon (host/) and `apx restart`
// (interfaces/cli/) both need them and neither may import the other — the CLI
// imports nothing from `#host/`, and rule 8 points the arrows the other way.
// Duplicating the numbers is how they drift.

/**
 * How long a shutdown waits for the turns already running to finish on their
 * own before cutting them off.
 *
 * Ten seconds because of what it is actually buying. The overwhelming majority
 * of turns are a few seconds long, so this covers them completely and
 * `apx restart` still feels instant — a shutdown with nothing in flight does
 * not wait at all. It deliberately does NOT cover the long tail: a turn can run
 * to the 300 s request budget, and a background a2a coding session for an hour.
 * Waiting for those would turn a restart into an unbounded hang, which is worse
 * than the cut — and a cut turn is no longer lost, it is persisted mid-sentence.
 */
export const DRAIN_MS = 10_000;

/**
 * After the drain gives up and aborts the stragglers, how long they get to
 * write their partial.
 *
 * The abort is the START of a write, not the end of one: each turn's catch
 * persists what it streamed into the conversation file and the ledger. Exiting
 * the instant we abort would throw away exactly what aborting was for.
 */
export const SETTLE_MS = 2_000;

/**
 * The hard stop. Armed before any teardown runs, so nothing that throws on the
 * way down can leave a half-dead daemon holding the port.
 *
 * Must exceed DRAIN_MS + SETTLE_MS with room to spare, or the watchdog fires
 * mid-drain and kills the turns instead of letting them land.
 */
export const SHUTDOWN_GRACE_MS = DRAIN_MS + SETTLE_MS + 3_000;

/**
 * How long `apx restart` waits for the old daemon to release the port.
 *
 * Must exceed SHUTDOWN_GRACE_MS: the daemon is guaranteed to be gone by then
 * (the watchdog sees to it), so giving up earlier reports "did not shut down in
 * time" about a daemon that is shutting down exactly as designed — and then
 * refuses to start the new one.
 */
export const PORT_RELEASE_WAIT_MS = SHUTDOWN_GRACE_MS + 5_000;
