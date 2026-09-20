// Which conversations have something nobody has read.
//
// chat-activity.ts answers a NARROWER question — "did a turn finish while I was
// looking somewhere else" — and it hears only what the turn feed broadcasts. A
// routine that wakes at nine and posts its report, a task an agent finishes on
// its own, a peer answering over a2a: none of those is a turn you started, and
// for several of them no frame reaches this device at all. golf-coach could
// file three reports and every rail stayed blank.
//
// What IS true whoever wrote it: the row's `preview_at` — when the AGENT last
// spoke — moved past the last one that was read. `preview_at` and not
// `last_activity_at` for the same reason lib/notify.ts picks it: activity also
// moves for your own send and for every tool row of a turn, so keying off it
// would light up the moment you pressed enter.
//
// ── WHO REMEMBERS IT ───────────────────────────────────────────────────────
//
// The daemon does. This file used to keep the marks in localStorage, per
// device, on the theory that "have I read this" is a property of the screen you
// are sitting at. One person with two devices is all it takes to break that:
// Manu read everything on the laptop, picked up the phone, and found forty blue
// rows he had already read — with no way to clear them except opening forty
// chats again. The dot had stopped meaning "there is something here".
//
// So the answer arrives ON the row (`row.unread`, decided in
// core/stores/read-marks.js) and reading marks it read through the API. What
// stays here is one device-local layer, `pending`: the marks this browser has
// just sent, so the dot goes out on the click instead of on the next fetch.
// Nothing in it is a second opinion — every entry is dropped the moment the
// daemon confirms the same thing.
import { Inbox, type InboxRow, type ReadMark } from "./api/inbox";
import { activityKeyForRow, markActivityRead } from "./chat-activity";
import { urlLooksAt } from "../screens/mobile/routes";

/** rowKey → the `preview_at` this device has already reported as read. Bounded
 *  by the fetch that confirms each entry; the cap is for the pathological case
 *  where the daemon is unreachable for a long time. */
const pending = new Map<string, string>();
const MAX_PENDING = 200;

let version = 0;
const listeners = new Set<() => void>();

/**
 * What makes an inbox row ITSELF: who it belongs to, and where.
 *
 * It identifies a row for React, for "is this the selected one", for finding
 * the same row again after the list refreshes underneath, and for the marks
 * above — so anything two rows can differ by has to be in here, or those two
 * rows become one. The daemon derives the same four facts its own way
 * (`readMarkKey`), from the row it is about to send, so neither side has to
 * parse the other's spelling.
 *
 * The person is in it because on a channel that talks to several (WhatsApp),
 * every row is the super-agent's on the same channel: without this, Manu, Magui
 * and Carlos shared one key, so all three lit up as selected together and
 * clicking any of them opened whichever the list found first.
 *
 * The PERSON and not the conversation id: the id is a day of the ledger and
 * rolls over at midnight, which is exactly the move `threadMoved` exists to
 * follow. A key that changed with it would drop the selection every night — and
 * there, would mark every conversation unread once a day at 00:00.
 */
export function inboxRowKey(row: InboxRow): string {
  return `${row.project_id ?? "global"}::${row.agent_slug}::${row.channel ?? ""}::${row.contact_person ?? ""}`;
}

/** When the agent last spoke on this row. Empty for a row it has never
 *  answered on — which therefore can never be unread. */
function stampOf(row: InboxRow): string {
  return row.preview_at || "";
}

function publish() {
  version++;
  for (const fn of listeners) fn();
}

/** Has the agent said something here since anybody last looked? */
export function isRowUnread(row: InboxRow): boolean {
  const at = stampOf(row);
  if (!at) return false;
  // This device has already said it read this, and the list in hand was
  // fetched before that landed. The daemon agrees within one fetch.
  const sent = pending.get(inboxRowKey(row));
  if (sent && sent >= at) return false;
  return row.unread === true;
}

// ── sending the mark ────────────────────────────────────────────────────────
//
// Batched through a microtask so that one inbox response marking several rows
// (the pane on screen, plus the selection the inbox keeps in state) is one
// request, and so that a list re-rendering twice in a tick is not two.
// Each entry carries the key it was filed under rather than rebuilding it from
// the mark: a second copy of `inboxRowKey` here is how the two spellings drift
// and a failed send fails to forget itself.
let queue: { key: string; mark: ReadMark }[] = [];
let flushing = false;

function flush() {
  const batch = queue;
  queue = [];
  flushing = false;
  if (!batch.length) return;
  void Inbox.markRead(batch.map((q) => q.mark)).catch(() => {
    // The daemon did not take it — offline, restarting, a token that has gone
    // stale. Forget having sent it: the dot comes back, which is the truth, and
    // the next list that lands tries again.
    for (const { key, mark } of batch) {
      if (pending.get(key) === mark.at) pending.delete(key);
    }
    publish();
  });
}

/** Reading it counts as having been told — everywhere. Idempotent. */
export function markRowRead(row: InboxRow) {
  const at = stampOf(row);
  if (!at) return;
  const key = inboxRowKey(row);
  // The live registry's own dot is per device and cannot hear the daemon, so
  // clear it here too — otherwise the tab that watched the turn end keeps a
  // mark the rest of the install has dropped. Before the guard below, because
  // that dot can be up on a row the daemon already considers read.
  const cleared = markActivityRead(activityKeyForRow(row));
  // Already read as far as the daemon is concerned. Without this the inbox
  // would re-send the same mark every time its list refreshed, because the
  // screen re-states "the open chat is read" on every list and the local note
  // of having sent it is dropped as soon as the daemon confirms it.
  if (row.unread === false) {
    if (cleared) publish();
    return;
  }
  const sent = pending.get(key);
  if (sent && sent >= at) return;
  pending.set(key, at);
  if (pending.size > MAX_PENDING) {
    // Oldest first: an entry this old is either confirmed already or belongs to
    // a daemon that has not answered in a very long time.
    const oldest = [...pending.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    for (const [k] of oldest.slice(0, pending.size - MAX_PENDING)) pending.delete(k);
  }
  queue.push({
    key,
    mark: {
      project_id: row.project_id ?? null,
      agent_slug: row.agent_slug,
      channel: row.channel ?? null,
      contact_person: row.contact_person ?? null,
      at,
    },
  });
  if (!flushing) {
    flushing = true;
    queueMicrotask(flush);
  }
  publish();
}

/**
 * Fold a fresh inbox list into the read state.
 *
 * Three jobs, all of which have to happen wherever the rows land rather than in
 * one screen:
 *
 *   · mark read whatever this window is ALREADY looking at — a chat open on
 *     screen must not grow a dot for the answer you are watching arrive.
 *     `urlLooksAt` knows all three surfaces (phone path, panel query, inbox
 *     deep link), so this stays one rule instead of three.
 *   · drop the local marks the daemon has now confirmed, so `pending` stays a
 *     bridge across one request and never becomes a second memory.
 *   · clear the device-local activity dot for a row somebody read SOMEWHERE
 *     ELSE. That registry only ever hears turn frames; without this, the tab
 *     that watched a turn finish keeps its dot after the phone read it.
 *
 * There is no baseline to take any more: the daemon stamps one the first time
 * it is asked (`seeded_at`), so a fresh browser — or a browser with its storage
 * cleared — shows what is actually unread instead of announcing everything or
 * nothing.
 */
export function syncReadMarks(rows: InboxRow[]) {
  if (!rows.length) return;
  let changed = false;

  const looking =
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    typeof window !== "undefined";

  for (const row of rows) {
    const at = stampOf(row);
    if (!at) continue;
    const key = inboxRowKey(row);

    if (looking && row.unread === true && urlLooksAt(window.location.href, row)) {
      markRowRead(row);
      continue;
    }

    if (row.unread === false) {
      // Confirmed by the daemon: this device has nothing left to remember, and
      // nothing left to draw.
      const sent = pending.get(key);
      if (sent && sent <= at) {
        pending.delete(key);
        changed = true;
      }
      if (markActivityRead(activityKeyForRow(row))) changed = true;
    }
  }

  if (changed) publish();
}

export function subscribeReadMarks(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Snapshot for useSyncExternalStore — a counter, since the marks themselves
 *  are a mutable map and would compare equal on every change. */
export function readMarksVersion(): number {
  return version;
}

/** Test seam. */
export function resetChatRead() {
  pending.clear();
  queue = [];
  publish();
}
