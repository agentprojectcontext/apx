// What has been READ — for the install, not for one browser.
//
// This used to live in `localStorage`, one copy per device, on the theory that
// "have I read this" is a property of the screen you are sitting at rather than
// of the conversation. That theory does not survive one person with two
// devices: an afternoon of reading on the laptop left the phone with forty blue
// rows, every one of them already read, and no way to clear them except opening
// forty chats again. The dot stopped meaning "there is something here" and
// started meaning "you have not held THIS device since it arrived", which is
// not a fact anybody wants a badge for.
//
// So the owner is the daemon. One file, `~/.apx/read-marks.json`, read by the
// inbox projection and written by whichever surface opened the chat. Every
// panel, phone and tab agrees because they are all reading the same answer.
//
// ── the shape ──────────────────────────────────────────────────────────────
//
//   { "seeded_at": "2026-09-20T12:00:00Z", "marks": { "<key>": "<iso>" } }
//
// A mark is the agent's utterance that was read — `preview_at`, never
// `last_activity_at`: activity also moves for your own send and for every tool
// row of a turn (560 of them on one busy Telegram day), so a watermark on it
// would clear the dot the moment you pressed enter, and raise it again on a
// tool nobody reads.
//
// `seeded_at` is the watermark for every row with no mark of its own, and it is
// what makes the FIRST run bearable: the file is created the first time anyone
// asks, stamped now, and everything said before that moment counts as read. A
// store that started empty without it would announce every conversation the
// daemon has ever held. A conversation that starts AFTER it has no mark and a
// `preview_at` past the stamp, so it is unread — which is the row most worth
// pointing at, not the one to hide.
import fs from "node:fs/promises";
import path from "node:path";
import { READ_MARKS_PATH } from "#core/config/paths.js";
import { nowIso } from "../util/time.js";

/** Marks are cheap but not free; a daemon that has talked to hundreds of
 *  threads would otherwise grow this forever. Oldest read-marks go first — they
 *  are also the ones `seeded_at` already answers correctly. */
const MAX_MARKS = 1000;
const KEEP_MARKS = 800;

/**
 * What makes a conversation ITSELF, for the purpose of remembering it was read.
 *
 * The same four facts the panel identifies an inbox row by, and for the same
 * reasons: the PERSON is in it because a channel that talks to several
 * (WhatsApp) gives every one of them a row of the super-agent's on that one
 * channel, and the person rather than the conversation id because the id is a
 * day of the ledger and rolls over at midnight — a key that moved with it would
 * mark every conversation unread once a day at 00:00.
 */
export function readMarkKey(row) {
  const project = row?.project_id ?? "global";
  return [
    project,
    row?.agent_slug ?? "",
    row?.channel ?? "",
    row?.contact_person ?? "",
  ].join("::");
}

/** When the agent last spoke on this row. Empty for a row it has never answered
 *  on — which therefore can never be unread. */
function stampOf(row) {
  return String(row?.preview_at || "");
}

function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const marks = raw.marks && typeof raw.marks === "object" ? raw.marks : {};
  const seeded = typeof raw.seeded_at === "string" ? raw.seeded_at : "";
  if (!seeded) return null;
  const clean = {};
  for (const [key, at] of Object.entries(marks)) {
    if (typeof key === "string" && typeof at === "string" && at) clean[key] = at;
  }
  return { seeded_at: seeded, marks: clean };
}

async function write(store) {
  await fs.mkdir(path.dirname(READ_MARKS_PATH), { recursive: true });
  // Written through a temp file: two surfaces can open a chat at the same
  // second, and a half-written store reads back as "nothing has ever been
  // read", which is the one failure that would re-light every row at once.
  const tmp = `${READ_MARKS_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`);
  await fs.rename(tmp, READ_MARKS_PATH);
}

/**
 * The marks as they stand, creating the baseline the first time anyone asks.
 *
 * A read that writes, once ever: the baseline has to be pinned to a real
 * moment, and the first question is the only honest place to pin it. Every
 * later call is a plain read.
 */
export async function readReadMarks() {
  let raw = null;
  try {
    raw = normalize(JSON.parse(await fs.readFile(READ_MARKS_PATH, "utf8")));
  } catch {
    // Missing, unreadable or corrupt: all three mean "no baseline yet", and a
    // fresh one is better than a store nobody can add to.
    raw = null;
  }
  if (raw) return raw;
  const seeded = { seeded_at: nowIso(), marks: {} };
  try {
    await write(seeded);
  } catch {
    // A home that cannot be written to still gets a working inbox — it just
    // forgets on the next request rather than dropping the whole list.
  }
  return seeded;
}

/** The moment this row was last read: its own mark, or the baseline. */
function watermark(store, row) {
  return store.marks[readMarkKey(row)] || store.seeded_at;
}

/** Has the agent said something here since anybody last looked? */
export function isRowUnread(row, store) {
  const at = stampOf(row);
  if (!at) return false;
  return at > watermark(store, row);
}

/** Stamp `unread` onto every row of an inbox listing. */
export function decorateUnread(rows, store) {
  return rows.map((row) => ({ ...row, unread: isRowUnread(row, store) }));
}

function prune(marks) {
  const entries = Object.entries(marks);
  if (entries.length <= MAX_MARKS) return marks;
  entries.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  return Object.fromEntries(entries.slice(0, KEEP_MARKS));
}

/**
 * Record that these rows were read up to the utterance each one names.
 *
 * `{ project_id, agent_slug, channel, contact_person, at }` per row — the
 * identity, plus the `preview_at` the reader actually had in hand. Their own
 * timestamp and not `now`, because an answer that arrived between the fetch and
 * this call has not been read by anyone and must stay unread.
 *
 * Never moves a mark backwards: two devices reading the same row in either
 * order leave the newer of the two standing.
 *
 * @returns {Promise<number>} how many marks moved.
 */
export async function markRowsRead(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 0;
  const store = await readReadMarks();
  let moved = 0;
  for (const row of list) {
    const at = String(row?.at || row?.preview_at || "");
    if (!at || !row?.agent_slug) continue;
    const key = readMarkKey(row);
    if (store.marks[key] && store.marks[key] >= at) continue;
    store.marks[key] = at;
    moved++;
  }
  if (!moved) return 0;
  store.marks = prune(store.marks);
  await write(store);
  return moved;
}

/** Test seam: forget every mark, including the baseline. */
export async function _resetReadMarksForTest() {
  await fs.rm(READ_MARKS_PATH, { force: true });
}
