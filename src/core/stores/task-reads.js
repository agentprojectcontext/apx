// What has been read ON A TASK — for the install, not for one browser.
//
// The same question `read-marks.js` answers for conversations, and the same
// answer: the daemon owns it, so the laptop and the phone agree about which
// cards are still asking for something. Read its header for why this does not
// live in `localStorage`.
//
// A SECOND FILE rather than a second section of that one, because the two are
// keyed differently and pruned against different volumes. A conversation is
// identified by (project, agent, channel, person) and there are dozens of them;
// a task is identified by (project, task id) and there are hundreds, arriving
// in bursts when a routine files its morning batch. Sharing a store would mean
// sharing a cap, and the busier half would evict the quieter one's marks.
//
// ── the shape ──────────────────────────────────────────────────────────────
//
//   { "seeded_at": "2026-09-20T12:00:00Z", "marks": { "<pid>::<task>": "<iso>" } }
//
// The mark is `activity_at` — the newest thing on the task that somebody ELSE
// did (core/tasks/attention.js). Not `updated_at`: that also moves for the
// owner's own comment and for every field they edit, so a watermark on it would
// clear the dot as they typed and raise it again on their own next keystroke.
//
// `seeded_at` is the watermark for every task with no mark of its own, and it
// is what makes the first run bearable: without it, turning this on would light
// up every task the daemon has ever held.
import fs from "node:fs/promises";
import path from "node:path";
import { TASK_READS_PATH } from "#core/config/paths.js";
import { nowIso } from "../util/time.js";

/** Tasks outlive conversations and arrive in bigger batches, so this cap is
 *  higher than the inbox's. Oldest marks go first — they are also the ones
 *  `seeded_at` already answers correctly. */
const MAX_MARKS = 4000;
const KEEP_MARKS = 3000;

/** A task is (project, id). The id alone collides across projects, and a task
 *  read in one project must not clear its namesake in another. */
export function taskReadKey(projectId, taskId) {
  return `${projectId ?? "global"}::${taskId ?? ""}`;
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
  await fs.mkdir(path.dirname(TASK_READS_PATH), { recursive: true });
  // Through a temp file: two surfaces can open a task in the same second, and a
  // half-written store reads back as "nothing has ever been read", which would
  // re-light every card at once.
  const tmp = `${TASK_READS_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`);
  await fs.rename(tmp, TASK_READS_PATH);
}

/** The marks as they stand, pinning the baseline the first time anyone asks. */
export async function readTaskReads() {
  let raw = null;
  try {
    raw = normalize(JSON.parse(await fs.readFile(TASK_READS_PATH, "utf8")));
  } catch {
    raw = null;
  }
  if (raw) return raw;
  const seeded = { seeded_at: nowIso(), marks: {} };
  try {
    await write(seeded);
  } catch {
    // A home that cannot be written to still gets a working task list; it just
    // forgets on the next request.
  }
  return seeded;
}

/** When this task was last looked at: its own mark, or the baseline. */
function watermark(store, projectId, taskId) {
  return store.marks[taskReadKey(projectId, taskId)] || store.seeded_at;
}

/**
 * Has somebody else touched this task since anybody last looked at it?
 *
 * `activity_at` empty means nothing here is anyone else's doing — a task you
 * filed and nobody has answered cannot be unread, however recently you edited
 * it.
 */
export function isTaskUnread(row, store, projectId) {
  const at = String(row?.activity_at || "");
  if (!at) return false;
  return at > watermark(store, projectId ?? row?.project_id, row?.id);
}

/** Stamp `unread` onto every row of a task listing. */
export function decorateTaskUnread(rows, store, projectId) {
  return rows.map((row) => ({ ...row, unread: isTaskUnread(row, store, projectId) }));
}

function prune(marks) {
  const entries = Object.entries(marks);
  if (entries.length <= MAX_MARKS) return marks;
  entries.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  return Object.fromEntries(entries.slice(0, KEEP_MARKS));
}

/**
 * Record that these tasks were read up to the activity each one names.
 *
 * `{ project_id, id, at }` per row — the identity plus the `activity_at` the
 * reader actually had in hand, not `now`: a comment that arrived between the
 * fetch and this call has not been read by anyone and must stay unread.
 *
 * Never moves a mark backwards, so two devices reading in either order leave
 * the newer of the two standing.
 *
 * @returns {Promise<number>} how many marks moved.
 */
export async function markTasksRead(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 0;
  const store = await readTaskReads();
  let moved = 0;
  for (const row of list) {
    const at = String(row?.at || row?.activity_at || "");
    if (!at || !row?.id) continue;
    const key = taskReadKey(row.project_id, row.id);
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
export async function _resetTaskReadsForTest() {
  await fs.rm(TASK_READS_PATH, { force: true });
}
