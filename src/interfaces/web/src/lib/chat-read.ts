// Which conversations have something you have not read.
//
// chat-activity.ts answers a NARROWER question — "did a turn finish while I was
// looking somewhere else" — and it hears only what the turn feed broadcasts. A
// routine that wakes at nine and posts its report, a task an agent finishes on
// its own, a peer answering over a2a: none of those is a turn you started, and
// for several of them no frame reaches this device at all. golf-coach could
// file three reports and every rail stayed blank.
//
// What IS true whoever wrote it: the row's `preview_at` — when the AGENT last
// spoke — moved past the last one this device saw. That is all this module is.
// `preview_at` and not `last_activity_at` for the same reason lib/notify.ts
// picks it: activity also moves for your own send and for every tool row of a
// turn, so keying off it would light up the moment you pressed enter.
//
// Per device, in localStorage, keyed by the identity the inbox already uses for
// a row. Nothing is sent to the daemon: "have I read this" is a property of the
// screen you are sitting at, not of the conversation.
import type { InboxRow } from "./api/inbox";
import { urlLooksAt } from "../screens/mobile/routes";

const STORE_KEY = "apx.chat.read.v1";
/** Marks are cheap but not free; a daemon that has talked to hundreds of
 *  threads would otherwise grow this forever. Oldest read-marks go first. */
const MAX_MARKS = 500;
const KEEP_MARKS = 400;

interface ReadStore {
  /** True once this device has taken a baseline. Without it the first load
   *  after clearing storage would announce every conversation ever held. */
  seeded: boolean;
  /** rowKey → the `preview_at` that was read. */
  marks: Record<string, string>;
}

let store: ReadStore | null = null;
let version = 0;
const listeners = new Set<() => void>();

/**
 * What makes an inbox row ITSELF: who it belongs to, and where.
 *
 * It identifies a row for React, for "is this the selected one", for finding
 * the same row again after the list refreshes underneath, and for remembering
 * that it was read — so anything two rows can differ by has to be in here, or
 * those two rows become one.
 *
 * The person is in it because on a channel that talks to several (WhatsApp),
 * every row is the super-agent's on the same channel: without this, Manu, Magui
 * and Carlos shared one key, so all three lit up as selected together and
 * clicking any of them opened whichever the list found first.
 *
 * The PERSON and not the conversation id: the id is a day of the ledger and
 * rolls over at midnight, which is exactly the move `threadMoved` exists to
 * follow. A key that changed with it would drop the selection every night — and
 * here, would mark every conversation unread once a day at 00:00.
 */
export function inboxRowKey(row: InboxRow): string {
  return `${row.project_id ?? "global"}::${row.agent_slug}::${row.channel ?? ""}::${row.contact_person ?? ""}`;
}

/** When the agent last spoke on this row. Empty for a row it has never
 *  answered on — which therefore can never be unread. */
function stampOf(row: InboxRow): string {
  return row.preview_at || "";
}

function load(): ReadStore {
  if (store) return store;
  store = { seeded: false, marks: {} };
  if (typeof localStorage === "undefined") return store;
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (raw && typeof raw === "object" && raw.marks && typeof raw.marks === "object") {
      store = { seeded: !!raw.seeded, marks: { ...raw.marks } };
    }
  } catch {
    // Private mode / corrupt preference: start from an unseeded baseline.
  }
  return store;
}

function persist() {
  if (typeof localStorage === "undefined" || !store) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // A per-device hint must never break the inbox.
  }
}

function prune(s: ReadStore) {
  const entries = Object.entries(s.marks);
  if (entries.length <= MAX_MARKS) return;
  entries.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  s.marks = Object.fromEntries(entries.slice(0, KEEP_MARKS));
}

function publish() {
  version++;
  for (const fn of listeners) fn();
}

/** Has the agent said something here since this device last looked? */
export function isRowUnread(row: InboxRow): boolean {
  const at = stampOf(row);
  if (!at) return false;
  const s = load();
  // Before the baseline exists, nothing is news: the first pass is what
  // establishes what "already seen" means.
  if (!s.seeded) return false;
  const seen = s.marks[inboxRowKey(row)];
  // No mark AFTER seeding means a conversation that did not exist last time —
  // the one most worth pointing at, not the one to hide.
  return seen === undefined || at > seen;
}

/** Reading it counts as having been told. Idempotent. */
export function markRowRead(row: InboxRow) {
  const at = stampOf(row);
  if (!at) return;
  const s = load();
  const key = inboxRowKey(row);
  if (s.marks[key] === at) return;
  s.marks[key] = at;
  prune(s);
  persist();
  publish();
}

/**
 * Fold a fresh inbox list into the read marks.
 *
 * Two jobs, both of which have to happen wherever the rows land rather than in
 * one screen: take the first baseline, and mark read whatever this window is
 * ALREADY looking at — a chat open on screen must not grow a dot for the answer
 * you are watching arrive. `urlLooksAt` knows all three surfaces (phone path,
 * panel query, inbox deep link), so this stays one rule instead of three.
 */
export function syncReadMarks(rows: InboxRow[]) {
  if (!rows.length) return;
  const s = load();
  let changed = false;

  if (!s.seeded) {
    for (const row of rows) {
      const at = stampOf(row);
      if (at) s.marks[inboxRowKey(row)] = at;
    }
    s.seeded = true;
    changed = true;
  }

  const looking =
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    typeof window !== "undefined";
  if (looking) {
    for (const row of rows) {
      const at = stampOf(row);
      if (!at) continue;
      const key = inboxRowKey(row);
      if (s.marks[key] === at) continue;
      if (!urlLooksAt(window.location.href, row)) continue;
      s.marks[key] = at;
      changed = true;
    }
  }

  if (!changed) return;
  prune(s);
  persist();
  publish();
}

export function subscribeReadMarks(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Snapshot for useSyncExternalStore — a counter, since the marks themselves
 *  are a mutable object and would compare equal on every change. */
export function readMarksVersion(): number {
  return version;
}

/** Test seam. */
export function resetChatRead() {
  store = null;
  publish();
}
