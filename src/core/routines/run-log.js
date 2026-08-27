// The runs a routine has ALREADY made, read back out of the ledger.
//
// There is no runs table: a run leaves exactly one summary row — the runner's
// end-of-run system message (runner.js) carrying meta.status, meta.result and
// meta.flow. The ledger is the record, and this module is the one place that
// knows how to read it back.
//
// The catch, and the bug this fixes: `meta.routine` is NOT the mark of a run.
// The CRUD route stamps it on "routine X created / updated" rows too
// (host/daemon/api/routines.js), and those are `system` rows from the same
// actor. The panel filtered on actor + meta.routine, so EDITING a routine
// appended a row to its execution history — and since an edit carries no
// meta.status, the list drew it as a successful run. A routine whose header
// said "last run: 3 h ago" showed a run that had supposedly finished minutes
// ago, which is worse than showing nothing.
//
// What actually marks a run is `meta.status`. Only the runner writes it.
import { readProjectMessages } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";

/** The statuses a finished run can carry, as the surfaces name them. */
export const RUN_STATUS = { OK: "ok", ERROR: "error", SKIPPED: "skipped" };

/** Is this ledger row the summary of a RUN (as opposed to a CRUD event)? */
export function isRoutineRunRow(row, name) {
  const meta = row?.meta || {};
  if (name && meta.routine !== name) return false;
  if (!meta.routine) return false;
  // A CRUD row names its event and carries no status; a run carries a status
  // and no event. Checking both ways means a future event type cannot sneak in.
  if (meta.event) return false;
  return typeof meta.status === "string" && meta.status.length > 0;
}

/** ok / error / skipped — what the row's status and skip flag amount to. */
export function runRowStatus(row) {
  const meta = row?.meta || {};
  if (meta.skipped) return RUN_STATUS.SKIPPED;
  return meta.status === RUN_STATUS.ERROR ? RUN_STATUS.ERROR : RUN_STATUS.OK;
}

/**
 * One run, in the shape a surface renders — so no caller has to know that a run
 * is a message with a particular meta on it. `conversation_id` + `agent_slug`
 * are lifted out of the result because they are what "open this run's chat"
 * needs, and digging for them was why the link only ever existed in one place.
 */
export function shapeRoutineRun(row) {
  const meta = row?.meta || {};
  const result = meta.result || {};
  return {
    ts: row.ts,
    routine: meta.routine,
    status: runRowStatus(row),
    skipped: !!meta.skipped,
    body: row.body || "",
    result,
    flow: meta.flow || null,
    conversation_id: typeof result.conversation_id === "string" ? result.conversation_id : null,
    agent_slug: typeof result.agent_slug === "string" ? result.agent_slug : null,
  };
}

/**
 * A routine's run history, newest first.
 *
 * Reads more rows than it returns on purpose: one run writes a row per tool
 * call plus its summary, so the summaries of 50 runs are scattered through
 * hundreds of rows, and every routine in the project shares this channel. The
 * scan window is the ceiling on how far back "the last N runs" can see, not on
 * how many come back. 1000 is also readProjectMessages' own hard cap.
 */
export function listRoutineRunLog(projectRoot, name, { limit = 50, scan = 1000 } = {}) {
  // Newest first already — readProjectMessages sorts descending and then slices,
  // so the scan window is the most recent `scan` rows of the routine channel.
  const rows = readProjectMessages(projectRoot, { channel: CHANNELS.ROUTINE, limit: scan });
  return rows.filter((r) => isRoutineRunRow(r, name)).map(shapeRoutineRun).slice(0, limit);
}
