// Letting the work in flight finish before the daemon goes down.
//
// `apx restart` used to abort every running turn on the way out. That was
// already a big improvement over the version that lost them silently — an
// aborted turn runs its own catch, and the catch persists whatever streamed —
// but it still answered the wrong question. You restart because you changed
// code, not because you wanted the answer on screen to stop, and a turn is
// usually a few seconds long. Given ten seconds of patience most of them
// simply finish.
//
// So the shutdown drains first and aborts second. These tests are about the
// three things that makes true, none of which the shutdown-guard test can see:
// a quiet restart still costs nothing, a turn that can finish is not cut off,
// and a turn that cannot is still cut off rather than waited on forever.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-turn-drain-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // APX_HOME wins over HOME — set both or this shares the runner's sandbox

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  startActiveTurn, endActiveTurn, drainActiveTurns, getActiveTurnByKey, listActiveTurns,
} = await import("../src/host/daemon/active-turns.js");

/** Short enough to keep the suite fast, long enough that the ordering under
 *  test is not a coin flip on a loaded machine. */
const CEILING = 400;
const SETTLE = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("with nothing in flight it does not wait at all", async () => {
  // The ordinary restart. If this ever starts waiting, every `apx restart`
  // pays the drain ceiling for turns that do not exist.
  const t0 = Date.now();
  const result = await drainActiveTurns({ timeoutMs: CEILING, settleMs: SETTLE });
  assert.deepEqual(result, { waited: false, finished: 0, aborted: 0 });
  assert.ok(Date.now() - t0 < CEILING / 2, "a quiet shutdown must resolve on the spot, not on the ceiling");
});

test("a turn that finishes in time is NOT cut off", async () => {
  // The whole point. Before the drain this turn was aborted mid-sentence; now
  // it gets to land, and its abort hook is never pulled.
  let pulled = false;
  const turn = startActiveTurn("p1:conv:finishes", { abort: () => { pulled = true; } });

  const t0 = Date.now();
  const drain = drainActiveTurns({ timeoutMs: CEILING, settleMs: SETTLE });
  setTimeout(() => endActiveTurn(turn.id), 40);
  const result = await drain;

  assert.equal(pulled, false, "the turn could have finished and was killed anyway");
  assert.deepEqual(result, { waited: true, finished: 1, aborted: 0 });
  assert.ok(Date.now() - t0 < CEILING,
    "it sat out the full ceiling after the last turn ended — the drain is notified, not polled");
});

test("a turn that outlasts the ceiling is cut off, so the restart is bounded", async () => {
  // The long tail: a 300 s request budget, or a background a2a coding session
  // that can run for an hour. Waiting for those would turn a restart into a
  // hang, which is worse than the cut — and the cut turn is not lost, it is
  // persisted mid-sentence.
  let pulled = false;
  const turn = startActiveTurn("p1:conv:forever", { abort: () => { pulled = true; } });
  try {
    const result = await drainActiveTurns({ timeoutMs: 60, settleMs: SETTLE });
    assert.equal(pulled, true, "the ceiling arrived and nothing cut the turn off");
    assert.deepEqual(result, { waited: true, finished: 0, aborted: 1 });
  } finally {
    endActiveTurn(turn.id);
  }
});

test("a turn that arrives mid-drain does not extend the wait, but is still cut off", async () => {
  // Both halves matter. The daemon keeps serving while it drains, so a steady
  // trickle of new turns (a routine firing, a Telegram message landing) would
  // hold the drain open for its full ceiling every single time if it waited
  // for them — but dropping them from the abort would exit with their partial
  // unwritten, which is the exact failure the whole path exists to prevent.
  let latePulled = false;
  const early = startActiveTurn("p1:conv:early", { abort: () => {} });
  const drain = drainActiveTurns({ timeoutMs: CEILING, settleMs: SETTLE });

  await sleep(20);
  const late = startActiveTurn("p1:conv:late", { abort: () => { latePulled = true; } });
  endActiveTurn(early.id);

  const t0 = Date.now();
  const result = await drain;
  assert.ok(Date.now() - t0 < CEILING,
    "the newcomer extended the wait — a busy daemon would never drain early");
  assert.equal(result.finished, 1, "only the snapshot counts as finished");
  assert.equal(result.aborted, 1, "the late turn was dropped instead of being given the chance to persist");
  assert.equal(latePulled, true);

  endActiveTurn(late.id);
});

test("the stragglers get their settle window before the process is allowed to exit", async () => {
  // The abort BEGINS a write — each turn's catch persists what it streamed.
  // Resolving the instant we abort would let the teardown close the stores out
  // from under that write, which is aborting with extra steps.
  const turn = startActiveTurn("p1:conv:slow-to-die", { abort: () => {} });
  try {
    const t0 = Date.now();
    await drainActiveTurns({ timeoutMs: 10, settleMs: 120 });
    assert.ok(Date.now() - t0 >= 120, "it exited the moment it aborted, with the partial still unwritten");
  } finally {
    endActiveTurn(turn.id);
  }
});

test("a turn with no abort hook is waited for, then reported honestly", async () => {
  // There should be none left — the a2a turn was the last one and it got its
  // hook. If one reappears, the drain must not claim to have stopped it, and
  // must still be bounded by the ceiling rather than hanging on it forever.
  const turn = startActiveTurn("p1:conv:hookless", {});
  try {
    const result = await drainActiveTurns({ timeoutMs: 60, settleMs: SETTLE });
    assert.deepEqual(result, { waited: true, finished: 0, aborted: 0 }, "nothing was pulled, so nothing may be claimed");
    assert.ok(getActiveTurnByKey("p1:conv:hookless"), "and it is still registered");
  } finally {
    endActiveTurn(turn.id);
  }
});

test("the registry is left clean for the next drain", () => {
  assert.deepEqual(listActiveTurns(), [], "a leaked turn here would make another test's drain wait on it");
});
