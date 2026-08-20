// The in-process event bus: "this just happened", for anyone in the SAME
// process who cares.
//
// Why it exists: every channel writes its turns through one of two funnels in
// stores/messages.js. Until now nothing announced those writes, so a surface
// that wanted to show a conversation as it happens had no choice but to poll —
// the web inbox re-fetched every 15s and an open thread never re-fetched at
// all. A message that arrived on Telegram was invisible to a browser sitting
// on the same conversation until someone reloaded the page.
//
// Layering (rule 8): core EMITS and never listens. It knows nothing about
// WebSockets, clients or the daemon — the emitted event carries only facts core
// already has (which channel, which day file, which project root). The daemon
// subscribes in host/daemon/events-ws.js, enriches what it alone knows (a
// project root is an id there, not here) and fans it out. Moving the emit
// upward into the adapter was the alternative and it does not work: the writes
// happen deep inside the Telegram dispatch and the agent loop, not at a route.
//
// SCOPE, and its one real limit: an EventEmitter is per PROCESS. Every write
// that matters happens inside the daemon — it owns the HTTP API, the Telegram
// poller and the agent loop, and the CLI reaches it over HTTP — so the daemon's
// subscriber sees them all. A second process writing straight to the JSONL
// (a script, a test) is NOT announced. That is by design: the bus reports what
// this process did, it is not a filesystem watcher.
import { EventEmitter } from "node:events";

const bus = new EventEmitter();
// One listener per subscriber, but a daemon may hold several (the WS hub today,
// more later) and Node warns at 10. Raise it rather than leak a real warning.
bus.setMaxListeners(50);

export const MESSAGE_EVENT = "message";

/**
 * A message was appended to the ledger.
 *
 * @param {object} event
 *   - scope        "global" (cross-project channel) | "project"
 *   - channel      telegram | web | desktop | …
 *   - thread       the day file's id (YYYY-MM-DD) — what a thread is addressed by
 *   - project_id   for a global write, whatever the record's meta claimed (may be null)
 *   - project_root for a project write, the storage path — the daemon maps it to an id
 *   - agent_slug   the agent the turn belongs to, when the write named one
 *   - direction    in | out
 *   - type         user | agent | tool | system | compact
 *   - ts           the record's timestamp
 *
 * Never throws into the caller: an announcement failing must not fail the write
 * that produced it. The ledger is the source of truth; this is a notification.
 */
export function emitMessageEvent(event) {
  try {
    bus.emit(MESSAGE_EVENT, event);
  } catch {
    /* a broken listener is the listener's problem, not the writer's */
  }
}

/** Subscribe to message events. Returns the unsubscribe function. */
export function onMessageEvent(fn) {
  bus.on(MESSAGE_EVENT, fn);
  return () => bus.off(MESSAGE_EVENT, fn);
}

/** Drop every listener. For tests, and for a clean daemon shutdown. */
export function resetEventBus() {
  bus.removeAllListeners();
}
