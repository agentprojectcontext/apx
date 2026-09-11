// One device-wide chat activity registry.
//
// Chat panes mount and unmount as navigation moves between Inbox, a project and
// the phone shell. A turn does not: it belongs to the daemon. Keeping the small
// UI projection here (running / unread / queued) gives every rail one contract
// and keeps a finished answer visible after the pane that started it is gone.
import { subscribeTurns } from "./live";
import type { ActiveTurn, TurnFrame } from "../types/daemon";

export interface ChatActivity {
  running: boolean;
  unread: boolean;
  queued: number;
  turnId?: string;
}

const EMPTY: ChatActivity = Object.freeze({ running: false, unread: false, queued: 0 });
const state = new Map<string, ChatActivity>();
const visible = new Set<string>();
const closedTurnIds = new Set<string>();
const listeners = new Set<() => void>();
const UNREAD_KEY = "apx.chat.unread.v1";
let wired = false;
let hydrated = false;

export function conversationActivityKey(pid: string | number, conversationId: string): string {
  return `${pid}:conv:${conversationId}`;
}

export function threadActivityKey(
  pid: string | number,
  channel: string,
  threadId: string,
): string {
  return `${pid}:thread:${channel}:${threadId}`;
}

export function liveActivityKey(pid: string | number, agentSlug: string): string {
  return `${pid}:live:${agentSlug}`;
}

export function activityKeyFromActiveTurn(active?: ActiveTurn | null): string | null {
  if (!active || active.project_id == null) return null;
  if (active.conversation_id) {
    return conversationActivityKey(active.project_id, active.conversation_id);
  }
  if (active.channel && active.thread_id) {
    return threadActivityKey(active.project_id, active.channel, active.thread_id);
  }
  return null;
}

function frameKey(frame: TurnFrame): string | null {
  if (frame.project_id == null) return null;
  if (frame.conversation_id) {
    return conversationActivityKey(frame.project_id, frame.conversation_id);
  }
  if (frame.channel && frame.thread_id) {
    return threadActivityKey(frame.project_id, frame.channel, frame.thread_id);
  }
  return null;
}

function hydrateUnread() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = JSON.parse(localStorage.getItem(UNREAD_KEY) || "[]");
    if (!Array.isArray(raw)) return;
    for (const key of raw) {
      if (typeof key === "string") state.set(key, { ...EMPTY, unread: true });
    }
  } catch {
    // Private mode / corrupt preference: unread starts empty.
  }
}

function persistUnread() {
  if (typeof window === "undefined") return;
  try {
    const keys = [...state.entries()].filter(([, value]) => value.unread).map(([key]) => key);
    localStorage.setItem(UNREAD_KEY, JSON.stringify(keys));
  } catch {
    // Per-device hint only; storage refusal must never break chat.
  }
}

/** Turn ids whose closing frame we have already seen, so a list response
 *  serialized just before it cannot revive them. Capped: a tab left open for a
 *  day watching a busy daemon would otherwise grow this set forever, and only
 *  the recent ones can still be contradicted by a response in flight. */
const MAX_CLOSED_IDS = 200;
function rememberClosed(turnId: string) {
  closedTurnIds.add(turnId);
  if (closedTurnIds.size <= MAX_CLOSED_IDS) return;
  // Sets iterate in insertion order, so the first entry is the oldest.
  for (const old of closedTurnIds) {
    closedTurnIds.delete(old);
    if (closedTurnIds.size <= MAX_CLOSED_IDS) break;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

function patch(key: string, next: Partial<ChatActivity>) {
  hydrateUnread();
  const current = state.get(key) || EMPTY;
  const value = { ...current, ...next };
  if (!value.running && !value.unread && !value.queued) state.delete(key);
  else state.set(key, value);
  publish();
}

/** Phases that mean the turn is STILL GOING. Everything else ends it.
 *
 * Spelled out as a set rather than as "not start, not delta", because that
 * shape is what broke: `event` — a tool starting, a tool landing, a closed text
 * segment — was added to the feed on 2026-09-11 and fell through to the
 * terminal branch below. The first tool of every turn therefore marked it
 * finished: the spinner died on the row, and worse, the turn id landed in
 * `closedTurnIds`, which is what `isChatTurnClosed` reads. Opening that chat
 * mid-turn then threw away the daemon's `active_turn` as stale, so a working
 * agent rendered as an idle one with nothing under it — and a message parked in
 * the queue drained on top of the turn still being written, because the pane
 * came back believing nothing was running.
 *
 * An a2a thread emits `event` and NOTHING else, so there it was total: a peer
 * worked for ten minutes and the thread showed the message that asked, alone.
 *
 * A phase this file does not know must therefore never be assumed terminal by
 * accident again; `tests/turn-phases.test.js` checks this set against every
 * phase the daemon can actually broadcast. */
const IN_FLIGHT_PHASES = new Set(["start", "delta", "event"]);

function onTurn(frame: TurnFrame) {
  const key = frameKey(frame);
  if (!key) return;
  if (IN_FLIGHT_PHASES.has(frame.phase)) {
    closedTurnIds.delete(frame.turn_id);
    patch(key, { running: true, turnId: frame.turn_id });
    return;
  }
  rememberClosed(frame.turn_id);
  const unread = frame.phase === "final" || frame.phase === "aborted"
    ? !visible.has(key)
    : false;
  patch(key, { running: false, unread, turnId: undefined });
  persistUnread();
}

function wire() {
  if (wired) return;
  wired = true;
  hydrateUnread();
  // Deliberately process-lifetime. Screens churn; the device-wide registry must
  // hear the closing frame even when no chat pane happens to be mounted.
  subscribeTurns(onTurn);
}

export function subscribeChatActivity(listener: () => void): () => void {
  wire();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function readChatActivity(key: string | null): ChatActivity {
  hydrateUnread();
  if (!key) return EMPTY;
  return state.get(key) || EMPTY;
}

/** Seed a list row from the daemon snapshot. Never clears a live frame with a
 * stale list response; closing frames own that transition. */
export function seedActiveTurn(key: string | null, active?: ActiveTurn | null) {
  if (!key || !active || closedTurnIds.has(active.turn_id)) return;
  patch(key, { running: true, turnId: active.turn_id });
}

/** A list/detail response can have been serialized just before its turn closed
 * frame arrived. Refuse that stale snapshot when the response reaches React. */
export function isChatTurnClosed(turnId?: string | null): boolean {
  return !!turnId && closedTurnIds.has(turnId);
}

export function setChatQueued(key: string | null, queued: number) {
  if (!key) return;
  patch(key, { queued: Math.max(0, queued) });
}

export function setChatVisible(key: string | null, shown: boolean) {
  if (!key) return;
  wire();
  if (shown) {
    visible.add(key);
    patch(key, { unread: false });
    persistUnread();
  } else {
    visible.delete(key);
  }
}

/** Test seam. */
export function resetChatActivity() {
  state.clear();
  visible.clear();
  closedTurnIds.clear();
  hydrated = false;
  publish();
}
