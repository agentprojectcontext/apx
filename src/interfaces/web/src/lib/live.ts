// The live feed: one WebSocket for the whole panel, telling it when a
// conversation moved somewhere else.
//
// Why one, shared: every screen wants the same feed, and a socket per hook
// would open half a dozen against the same daemon and reconnect them all in
// step. This module owns exactly one connection, opened when something first
// subscribes and kept for the life of the page.
//
// A frame is a SIGNAL, never content — see host/daemon/events-ws.js for why.
// Subscribers react by re-fetching through the API they already use, which is
// what makes the device that SENT a message not show it twice.
import { getToken } from "./http";
import { wsUrl } from "./net";

export interface LiveEvent {
  /** Which ledger moved. `resync` is not from the daemon — see below. */
  scope: "global" | "project" | "conversation" | "resync";
  channel: string | null;
  /** Day file id for a channel thread (YYYY-MM-DD). */
  thread: string | null;
  project_id: number | string | null;
  agent_slug: string | null;
  conversation_id: string | null;
  direction: string | null;
  type: string | null;
  ts: string | null;
}

type Listener = (events: LiveEvent[]) => void;

const listeners = new Set<Listener>();

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
/** True once a connection has been up and gone away: the next open has a gap
 *  to cover, so it announces a resync. A first connect has nothing to catch up
 *  on — the page just loaded its data. */
let missedWhileDown = false;

/** The event that says "you were disconnected; whatever you are showing may be
 *  stale". Matches everything, so every subscriber revalidates once. */
const RESYNC: LiveEvent = {
  scope: "resync",
  channel: null,
  thread: null,
  project_id: null,
  agent_slug: null,
  conversation_id: null,
  direction: null,
  type: null,
  ts: null,
};

function emit(events: LiveEvent[]) {
  for (const fn of listeners) {
    try {
      fn(events);
    } catch {
      /* one screen's handler must not stop the others from updating */
    }
  }
}

function backoffMs(): number {
  // 1s, 2s, 4s… capped at 15s. A phone that was asleep for an hour should come
  // back quickly, not after a minute-long backoff.
  return Math.min(15_000, 1000 * 2 ** Math.min(attempts, 4));
}

function scheduleReconnect() {
  if (reconnectTimer || !listeners.size) return;
  const delay = backoffMs();
  attempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (socket || !listeners.size) return;
  // No token yet (the bootstrap fetch is still in flight): the upgrade would be
  // rejected with a 401. Wait one beat rather than burning a reconnect attempt.
  const token = getToken();
  if (!token) {
    scheduleReconnect();
    return;
  }
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl("/api/events/ws", { token }));
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    attempts = 0;
    // Anything that happened while we were away was never delivered. Tell every
    // screen to revalidate once, or a phone that spent the afternoon in a
    // pocket comes back to a live socket over a stale conversation.
    if (missedWhileDown) {
      missedWhileDown = false;
      emit([RESYNC]);
    }
  };

  ws.onmessage = (msg) => {
    let frame: { type?: string; events?: LiveEvent[] };
    try {
      frame = JSON.parse(String(msg.data));
    } catch {
      return;
    }
    if (frame.type === "messages" && Array.isArray(frame.events)) emit(frame.events);
  };

  const dropped = () => {
    if (socket === ws) socket = null;
    missedWhileDown = true;
    scheduleReconnect();
  };
  ws.onclose = dropped;
  ws.onerror = () => {
    try { ws.close(); } catch { /* onclose still fires */ }
  };
}

/** Reconnect NOW rather than on the backoff — the page just became visible or
 *  the network came back, and both mean the old socket is probably dead. */
function wakeUp() {
  if (!listeners.size) return;
  if (socket && socket.readyState === WebSocket.OPEN) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // A socket the browser froze can sit in CONNECTING forever. Drop it first.
  if (socket) {
    const stale = socket;
    socket = null;
    try { stale.close(); } catch { /* already gone */ }
  }
  attempts = 0;
  connect();
}

let wired = false;
function wireWakeUps() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  // iOS suspends a backgrounded tab's socket without closing it, so returning
  // to the app is the only reliable moment to find out the feed is dead.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wakeUp();
  });
  window.addEventListener("online", wakeUp);
  window.addEventListener("focus", wakeUp);
}

/** Subscribe to the feed. Returns the unsubscribe function. */
export function subscribeLive(fn: Listener): () => void {
  listeners.add(fn);
  wireWakeUps();
  connect();
  return () => {
    listeners.delete(fn);
    // The socket stays open: screens mount and unmount constantly, and tearing
    // the connection down between two of them would reconnect all day.
  };
}

/** Does this event concern the channel thread on screen? */
export function concernsThread(ev: LiveEvent, channel: string, threadId: string): boolean {
  if (ev.scope === "resync") return true;
  return ev.scope === "global" && ev.channel === channel && ev.thread === threadId;
}

/** Does this event concern the stored conversation on screen? */
export function concernsConversation(ev: LiveEvent, agentSlug: string, convId: string): boolean {
  if (ev.scope === "resync") return true;
  if (ev.scope !== "conversation") return false;
  return ev.agent_slug === agentSlug && ev.conversation_id === convId;
}

/** Test seam: drop the connection and every subscriber. */
export function resetLive() {
  listeners.clear();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  attempts = 0;
  missedWhileDown = false;
  const open = socket;
  socket = null;
  try { open?.close(); } catch { /* already gone */ }
}
