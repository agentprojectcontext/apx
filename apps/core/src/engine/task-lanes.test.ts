// The office clock's lanes start only eligible work, the most pressing first, and recover stalled work a few at a time
// over checks that together look at every task in progress, also across a restart (DECISIONS.md#d-206).
import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT, LONG_AGO, laneFixture } from "./task-lanes-fixture.ts";
import { reviveStalled, STALL_AFTER_MS, STALL_AT_ONCE, STALL_PAGE } from "./task-stall.ts";
import { pickUpTasks, startScheduled } from "./task-work.ts";

const startedIds = (env: ReturnType<typeof laneFixture>) =>
  env.admitted.flatMap((a) => env.store.threads.get(a.thread_id)?.task_id ?? []);

test("the pickup skips what cannot start and begins the rest by priority, then nearest due date", (t) => {
  const env = laneFixture(t);
  const store = env.store;
  store.settings.set("task_work_since", new Date(Date.now() - 60_000).toISOString());
  const before = env.create({ priority: "urgent" });
  env.assignedLongAgo(before.id);
  const skipped = [
    env.create({ priority: "urgent", proposed: true }),
    env.create({ priority: "urgent", status: "review" }),
    env.create({ priority: "urgent", description: " " }),
    env.create({ priority: "urgent", start_at: "2099-01-01T00:00:00.000Z" }),
    env.create({ priority: "urgent", assignee: "ghost" }),
  ];
  const low = env.create({ priority: "low" });
  const later = env.create({ priority: "high", due_at: "2099-02-01T00:00:00.000Z" });
  const sooner = env.create({ priority: "high", due_at: "2099-01-01T00:00:00.000Z" });
  const urgent = env.create({ priority: "urgent" });
  env.crowd(STALL_PAGE);

  pickUpTasks(store, env.admit);
  assert.deepEqual(startedIds(env), [urgent.id, sooner.id, later.id], "three at a time, the most pressing first");
  pickUpTasks(store, env.admit);
  assert.deepEqual(startedIds(env), [urgent.id, sooner.id, later.id, low.id]);
  for (const id of [before.id, ...skipped.map((s) => s.id)])
    assert.equal(store.threads.byTask(id).length, 0, "never started by the pickup");
});

test("blank descriptions of any whitespace never take the clock's slots from work that can start", (t) => {
  const env = laneFixture(t);
  const store = env.store;
  store.settings.set("task_work_since", new Date(Date.now() - 60_000).toISOString());
  // Every character a start reads as blank: tabs, line breaks, no-break and ideographic spaces, a byte-order mark.
  const blanks = ["\n\t", "\r\n", "\t\v\f", "\u00a0\u3000", "\ufeff\u2028"];
  for (const description of blanks) env.create({ priority: "urgent", start_at: LONG_AGO, description });
  const scheduled = env.create({ start_at: "2021-01-01T00:00:00.000Z" });
  startScheduled(store, env.admit, new Date());
  assert.deepEqual(startedIds(env), [scheduled.id], "the scheduled task starts past the blank ones");
  const picked = env.create({ priority: "low" });
  pickUpTasks(store, env.admit);
  assert.deepEqual(startedIds(env), [scheduled.id, picked.id], "the pickup starts past them too");
});

test("a scheduled task an agent gave while paused waits for its chain, not the clock", (t) => {
  const env = laneFixture(t);
  const store = env.store;
  const held = env.create({ start_at: LONG_AGO });
  const free = env.create({ start_at: LONG_AGO });
  const holder = store.threads.create({ kind: "loose", title: "Paused chain", agent_ids: [AGENT] });
  store.threads.mergeContext(holder.id, { held: [{ task: held.id, agent: AGENT, run: "run_paused", depth: 1 }] });
  startScheduled(store, env.admit, new Date());
  assert.deepEqual(startedIds(env), [free.id]);
});

test("stalled work is asked to go on a few at a time, every task in progress in turn, across a restart", (t) => {
  const env = laneFixture(t);
  const stalled = Array.from({ length: STALL_AT_ONCE + 2 }, () => env.worked());
  // In progress but with no chat of its agent: looked at, never stalled.
  env.store.tx(() => {
    for (let i = 0; i < 2 * STALL_PAGE + 50; i++) env.create({ status: "doing" });
  });
  const later = new Date(Date.now() + STALL_AFTER_MS + 60_000);
  const revivedPerCheck: number[] = [];
  for (let check = 0; check < 8; check++) {
    revivedPerCheck.push(reviveStalled(env.store, env.admit, later).revived);
    env.reopen();
  }
  assert.ok(Math.max(...revivedPerCheck) <= STALL_AT_ONCE, `at most ${STALL_AT_ONCE} per check: ${revivedPerCheck}`);
  const revived = env.admitted.filter((a) => a.origin?.kind === "stalled_task");
  assert.deepEqual(
    revived.map((a) => env.store.threads.get(a.thread_id)?.task_id).sort(),
    stalled.map((s) => s.id).sort(),
    "each stalled task was asked once",
  );
});
