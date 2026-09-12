// The live feed: one WebSocket for the whole panel, telling it when a
// conversation moved somewhere else.
//
// Why one, shared: every screen wants the same feed, and a socket per hook
// would open half a dozen against the same daemon and reconnect them all in
// step. This module owns exactly one connection, opened when something first
// subscribes and kept for the life of the page.
//
// A message frame is a SIGNAL, never content — see host/daemon/events-ws.js for
// why. Subscribers react by re-fetching through the API they already use, which
// is what makes the device that SENT a message not show it twice. The two
// exceptions carry data because there is nothing to re-fetch YET: turn frames
// (tokens mid-answer) and routine frames (a run's steps, which only reach the
// ledger once the run is over).
import { getToken, refreshToken } from "./http";
import { wsUrl } from "./net";
import type { BackgroundJobFrame, RoutineFrame, TurnFrame } from "../types/daemon";

export interface LiveEvent {
  /** Which ledger moved. `resync` is not from the daemon — see below. */
  scope: "global" | "project" | "conversation" | "resync";
  channel: string | null;
  /** Day file id for a channel thread (YYYY-MM-DD). */
  thread: string | null;
  /** The room a project write belongs to, when its channel keeps several in one
   *  ledger: the group id, or the a2a pair id. Null everywhere else — those
   *  channels are addressed by day, which is what `thread` carries. */
  thread_id?: string | null;
  project_id: number | string | null;
  agent_slug: string | null;
  conversation_id: string | null;
  direction: string | null;
  type: string | null;
  /** A conversation write carries the role it was appended under
   *  (user / assistant / tool) instead of a direction and a type. */
  role?: string | null;
  ts: string | null;
}

type Listener = (events: LiveEvent[]) => void;
type TurnListener = (frame: TurnFrame) => void;
type RoutineListener = (frame: RoutineFrame) => void;
type JobListener = (frame: BackgroundJobFrame) => void;

const listeners = new Set<Listener>();
const turnListeners = new Set<TurnListener>();
const routineListeners = new Set<RoutineListener>();
const jobListeners = new Set<JobListener>();

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

function emitTurn(frame: TurnFrame) {
  for (const fn of turnListeners) {
    try {
      fn(frame);
    } catch {
      /* one screen's handler must not stop the others */
    }
  }
}

function emitRoutine(frame: RoutineFrame) {
  for (const fn of routineListeners) {
    try {
      fn(frame);
    } catch {
      /* one screen's handler must not stop the others */
    }
  }
}

function emitJob(frame: BackgroundJobFrame) {
  for (const fn of jobListeners) {
    try {
      fn(frame);
    } catch {
      /* one screen's handler must not stop the others */
    }
  }
}

function backoffMs(): number {
  // 1s, 2s, 4s… capped at 15s. A phone that was asleep for an hour should come
  // back quickly, not after a minute-long backoff.
  return Math.min(15_000, 1000 * 2 ** Math.min(attempts, 4));
}

function scheduleReconnect() {
  if (reconnectTimer || (!listeners.size && !turnListeners.size && !routineListeners.size && !jobListeners.size)) return;
  const delay = backoffMs();
  attempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

/** Whether the LAST attempt ever reached an open socket. A handshake refused
 *  for auth and a daemon that is down look identical from here; both are worth
 *  one token refresh before the next try. */
let rejected = false;

function connect() {
  if (socket || (!listeners.size && !turnListeners.size && !routineListeners.size && !jobListeners.size)) return;
  // No token yet (the bootstrap fetch is still in flight): the upgrade would be
  // rejected with a 401. Wait one beat rather than burning a reconnect attempt.
  const token = getToken();
  if (!token) {
    scheduleReconnect();
    return;
  }
  // The last attempt was REJECTED rather than dropped, so the token is the
  // first suspect: the daemon mints a new master token on every boot, and this
  // socket used to reconnect forever against the one it was holding when the
  // daemon restarted. A browser cannot read the handshake's status code, so
  // "never opened" is the signal — and asking for a fresh token is one cheap
  // loopback fetch, deduped, which is a fair price for the alternative (a panel
  // that is silently deaf until somebody thinks to reload it).
  if (rejected) {
    rejected = false;
    // Whatever the refresh answers, the loop goes on. Returning on a failed
    // refresh is how a "recovery" becomes worse than the thing it replaced: one
    // attempt while the daemon was still coming back up, no token, and the
    // socket never tried again — a panel that used to reconnect forever against
    // a dead token now simply stopped.
    void refreshToken()
      .catch(() => null)
      .then(() => { attempts = 0; scheduleReconnect(); });
    return;
  }
  // Per attempt, read by `dropped` below to tell a refused handshake from a
  // socket that lived and then died.
  let opened = false;
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
    opened = true;
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
    else if (frame.type === "turn") emitTurn(frame as unknown as TurnFrame);
    else if (frame.type === "routine") emitRoutine(frame as unknown as RoutineFrame);
    else if (frame.type === "background_job") emitJob(frame as unknown as BackgroundJobFrame);
  };

  const dropped = () => {
    if (socket === ws) socket = null;
    missedWhileDown = true;
    // Closed without ever opening: the upgrade was refused (bad token) or
    // nothing answered. Either way the next attempt should get a token first.
    if (!opened) rejected = true;
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
  if (!listeners.size && !turnListeners.size && !routineListeners.size && !jobListeners.size) return;
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

/** Subscribe to live-turn frames (token streams pushed by the daemon). Returns
 *  the unsubscribe function. Keeps the shared socket open like subscribeLive. */
export function subscribeTurns(fn: TurnListener): () => void {
  turnListeners.add(fn);
  wireWakeUps();
  connect();
  return () => { turnListeners.delete(fn); };
}

/** Subscribe to routine-run frames: a run starting, taking a step, or ending,
 *  wherever it was started from. Keeps the shared socket open like subscribeLive.
 *  Returns the unsubscribe function. */
export function subscribeRoutineRuns(fn: RoutineListener): () => void {
  routineListeners.add(fn);
  wireWakeUps();
  connect();
  return () => { routineListeners.delete(fn); };
}

/** Subscribe to background-job frames: an agent leaving work running, and that
 *  work ending. Carries the record, so a screen can draw "1 job running" without
 *  a fetch. Keeps the shared socket open like subscribeLive. Returns the
 *  unsubscribe function. */
export function subscribeBackgroundJobs(fn: JobListener): () => void {
  jobListeners.add(fn);
  wireWakeUps();
  connect();
  return () => { jobListeners.delete(fn); };
}

/** Does this event concern the channel thread on screen?
 *
 *  Two ways of addressing a thread, because there are two kinds. A global
 *  channel holds one thread per day, so the day IS the id. A project channel
 *  (a group room, an a2a pair) holds many in the same day file and names the
 *  one that moved in `thread_id` — which is the case this used to miss
 *  entirely: every group write is scope "project" with the bare date in
 *  `thread`, so the test below was false for every row a room ever wrote and an
 *  open room never re-read itself. */
export function concernsThread(ev: LiveEvent, channel: string, threadId: string): boolean {
  if (ev.scope === "resync") return true;
  if (ev.channel !== channel) return false;
  if (ev.thread_id) return ev.thread_id === threadId;
  return ev.scope === "global" && ev.thread === threadId;
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
  turnListeners.clear();
  routineListeners.clear();
  jobListeners.clear();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  attempts = 0;
  missedWhileDown = false;
  const open = socket;
  socket = null;
  try { open?.close(); } catch { /* already gone */ }
}
