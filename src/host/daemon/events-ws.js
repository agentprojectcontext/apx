// The live event feed: one WebSocket that tells every open surface "this
// conversation just moved".
//
// The problem it solves: APX is one agent reachable from several places at
// once — Telegram on the phone, the panel on the laptop, the deck on a tablet.
// Until now each surface only saw what it did itself. A turn that arrived on
// Telegram was invisible to a browser sitting on that very thread until someone
// reloaded, and two browsers open on the same inbox drifted apart within
// seconds. The daemon already knew — it wrote the row — it just never said so.
//
// SIGNAL, NOT DATA. A frame says which thread moved, never what was said. The
// client re-fetches through the routes it already uses. That is deliberate:
//   - one rendering path, not two. The record→bubble mapping lives in the API
//     and in useChat; a second copy on the wire is a second thing to keep true.
//   - a re-fetch is idempotent. Appending a pushed row is not: the device that
//     SENT the message already painted it, and would show it twice.
//   - nothing sensitive rides the socket beyond "channel X moved".
//
// Fan-out is per PROCESS and that is enough: the daemon owns the HTTP API, the
// Telegram poller and the agent loop, so every write anyone makes happens here.
// See core/events/bus.js for the one case it does not cover.
import { onMessageEvent, onMobilityAlert, onRoutineEvent } from "#core/events/bus.js";
import { mascotNoticesFromEvents } from "#core/events/mascot-notify.js";
import { resolveSuperAgentBlob } from "#core/apc/agent-identity.js";
import { apiPath } from "./api/prefix.js";

const _clients = new Set(); // Set<WebSocket>

export const eventsClients = _clients;

/** The feed's upgrade path. Under /api like every other route (rule 9). */
export const EVENTS_WS_PATH = apiPath("/events/ws");

/** Path-gate: is this upgrade for the live event feed? */
export function isEventsUpgradePath(url) {
  let pathname = url || "";
  try { pathname = new URL(url, "http://localhost").pathname; } catch { /* keep raw */ }
  return pathname === EVENTS_WS_PATH;
}

// A streamed Telegram answer writes one ledger row per chunk, so a chatty turn
// can emit a dozen events in a second. Collapsing them into one frame per
// window turns that into one re-fetch per window per device instead of a dozen.
// Short enough that it still reads as instant.
const FLUSH_MS = 250;

// Dead sockets do not always close: a phone that walks out of the tailnet
// leaves a half-open connection that accepts writes into nothing. Ping on an
// interval and drop whatever failed to answer the last one.
const PING_MS = 30_000;

/** Register a connected client. Sends a hello so the page can show it is live. */
export function registerEventsClient(ws, config = {}) {
  _clients.add(ws);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("close", () => _clients.delete(ws));
  ws.on("error", () => _clients.delete(ws));
  // The feed is one-directional. A client has nothing to say here — it acts
  // through the HTTP API — so anything it sends is ignored rather than parsed.
  ws.on("message", () => {});
  send(ws, {
    type: "hello",
    ts: new Date().toISOString(),
    settings: { super_agent: { icon: resolveSuperAgentBlob(config) } },
  });
}

/** Publish a hot-reloaded super-agent avatar to every connected surface. */
export function broadcastSuperAgentAvatar(config) {
  broadcastEvents({
    type: "settings",
    settings: { super_agent: { icon: resolveSuperAgentBlob(config) } },
  });
}

function send(ws, msg) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg)); // 1 = OPEN
  } catch { /* the close handler will drop it */ }
}

/** Fan one frame out to every connected client. */
export function broadcastEvents(msg) {
  for (const ws of _clients) send(ws, msg);
}

/** Push one live-turn frame (start / delta / final / error) to every surface —
 *  the token stream that used to belong only to the sending tab. Sent straight,
 *  NOT through the 250ms message batch: tokens must arrive as they are written.
 *  Unlike a "messages" frame this DOES carry data (the delta), on purpose — it
 *  is the one thing the signal-only feed cannot express, and losing it to a
 *  dropped connection is exactly the bug this fixes. */
export function broadcastTurn(frame) {
  broadcastEvents({ type: "turn", ...frame });
}

/** Push one routine-run frame (start / progress / end). Like a turn frame and
 *  unlike a message frame this CARRIES the data — a run's steps are not in the
 *  ledger until it ends, so there is nothing for a client to re-fetch while it
 *  is still going. Sent straight, not through the 250ms batch: the whole point
 *  is watching a run move. */
/**
 * A proximity alert, as its own frame.
 *
 * NOT collapsed into the 250 ms message window below: that window exists to
 * turn a chatty streamed turn into one re-fetch, and an alert is neither
 * chatty nor a re-fetch — it is one card, complete, that has to reach the
 * phone while the car is still near the place. It also carries its payload
 * rather than a "go look" signal, for the same reason.
 */
export function broadcastMobilityAlert(card) {
  broadcastEvents({ type: "mobility_alert", ts: new Date().toISOString(), alert: card });
}

export function broadcastRoutineRun(frame) {
  broadcastEvents({ type: "routine", ...frame });
}

/** Which project a write belongs to, as an id the panel can match on.
 *  A global write already carries one in its meta; a project or conversation
 *  write carries the storage path, which only the daemon's registry resolves. */
function projectIdOf(event, projects) {
  if (!event.project_root) return event.project_id ?? null;
  if (!projects?.list) return null;
  for (const entry of projects.list()) {
    try {
      if (projects.get(entry.id)?.storagePath === event.project_root) return entry.id;
    } catch { /* an unreadable project is not a match */ }
  }
  return null;
}

/** The public shape of one event. `project_root` never leaves the daemon —
 *  it is a path on this machine and the panel has no use for it. */
function publicEvent(event, projects) {
  return {
    scope: event.scope,
    channel: event.channel || null,
    thread: event.thread || null,
    project_id: projectIdOf(event, projects),
    agent_slug: event.agent_slug || null,
    // Only a conversation write has one; a channel thread is addressed by day.
    conversation_id: event.conversation_id || null,
    direction: event.direction || null,
    type: event.type || null,
    // A conversation write (a project agent's chat file) has no direction and
    // no type — it carries the ROLE it was appended under. Without it every
    // such write looks identical on the wire, and a surface that only wants to
    // hear about the agent SPEAKING has to re-fetch on the owner's own send and
    // on every tool row too. See lib/notify.ts.
    role: event.role || null,
    author: event.author || null,
    // How the row was produced, when it matters to a subscriber — "routine_delivery"
    // marks an agent reaching the owner, which the mascot surfaces on its own.
    via: event.via || null,
    // A ≤100-char headline for a delivery, so the mascot bubble can say what
    // arrived. A notice, not the message body — "signal, not data" holds.
    notify: event.notify || null,
    // Closing vs mid-turn chunk. The pet only bubbles an agent's launched
    // final on Telegram / group / A2A — never the owner's send.
    final: event.final === true ? true : null,
    streamed: event.streamed === true ? true : null,
    // Who an a2a row was addressed to, so the bubble can name both ends
    // ("de magui a roby") instead of just the channel. A name, not an address:
    // see appendMessageToFs, which only lifts it for a2a. Null everywhere else.
    to: event.to || null,
    ts: event.ts || null,
  };
}

/** Two events about the same thread in the same window are one re-fetch. */
function keyOf(e) {
  return [e.scope, e.channel, e.thread, e.project_id, e.agent_slug, e.conversation_id].join("|");
}

/**
 * Subscribe the hub to the core bus. Called once at daemon startup.
 * Returns a stop() that unsubscribes and clears the timers.
 */
export function startEventsBridge({ projects } = {}) {
  const pending = new Map();
  let flushTimer = null;

  const flush = () => {
    flushTimer = null;
    if (!pending.size) return;
    const events = [...pending.values()];
    pending.clear();
    // Nobody listening is the normal case (no panel open). Skip the work.
    if (_clients.size) {
      // Computed once here so desktop and the phone cannot drift: both pets
      // just render the lines. Empty means "this burst is not news" (the
      // owner sending, a stream chunk, a tool row).
      const notices = mascotNoticesFromEvents(events);
      broadcastEvents({
        type: "messages",
        events,
        notifications: notices.map((notice) => notice.text),
        // The same lines with the channel each one is about, so a device can
        // answer "which of these may ring me" — the phone mutes Telegram
        // because Telegram is installed on it. Sent alongside rather than
        // instead: an APK from before this shipped still reads `notifications`.
        notices,
      });
    }
  };

  // A routine run moving is its own signal: it is not a ledger write, and the
  // batch that collapses ledger writes would make a step list arrive in clumps.
  const unsubscribeRoutines = onRoutineEvent((event) => {
    if (!_clients.size) return;
    let projectId = null;
    try {
      projectId = projectIdOf(event, projects);
    } catch {
      return; // an unresolvable project is not worth taking the daemon down for
    }
    broadcastRoutineRun({
      phase: event.phase,
      project_id: projectId,
      routine: event.routine,
      run: event.run,
    });
  });

  // Proximity alerts. Straight out, no batching: see broadcastMobilityAlert.
  const unsubscribeMobility = onMobilityAlert((card) => {
    if (!_clients.size) return;
    broadcastMobilityAlert(card);
  });

  const unsubscribe = onMessageEvent((event) => {
    let pub;
    try {
      pub = publicEvent(event, projects);
    } catch {
      return; // a malformed event must not take the daemon down
    }
    pending.set(keyOf(pub), pub);
    if (!flushTimer) {
      flushTimer = setTimeout(flush, FLUSH_MS);
      // A pending frame must never be the reason the process stays up.
      flushTimer.unref?.();
    }
  });

  const pinger = setInterval(() => {
    for (const ws of _clients) {
      if (ws.isAlive === false) {
        _clients.delete(ws);
        try { ws.terminate(); } catch { /* already gone */ }
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { _clients.delete(ws); }
    }
  }, PING_MS);
  pinger.unref?.();

  return function stop() {
    unsubscribe();
    unsubscribeRoutines();
    unsubscribeMobility();
    clearInterval(pinger);
    if (flushTimer) clearTimeout(flushTimer);
    pending.clear();
    for (const ws of _clients) {
      try { ws.close(); } catch { /* already gone */ }
    }
    _clients.clear();
  };
}
