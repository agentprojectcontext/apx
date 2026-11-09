// The office clock finds eligible work however many open tasks are more recently active (issue #139): a scheduled
// start, the hourly pickup and the stall check never look only at the newest part of the board.
import assert from "node:assert/strict";
import { test } from "node:test";
import { laneFixture } from "./task-lanes-fixture.ts";
import { reviveStalled, STALL_AFTER_MS } from "./task-stall.ts";
import { pickUpTasks, startScheduled } from "./task-work.ts";

const CROWD = 600;
const started = (env: ReturnType<typeof laneFixture>, id: string) => env.store.threads.byTask(id).length > 0;

test("a scheduled task starts behind hundreds of more recent open tasks", (t) => {
  const env = laneFixture(t);
  const now = new Date();
  const task = env.create({ start_at: new Date(now.getTime() - 60_000).toISOString() });
  env.crowd(CROWD);
  env.age(task.id);
  startScheduled(env.store, env.admit, now);
  assert.ok(started(env, task.id));
});

test("the hourly pickup starts a task behind hundreds of more recent open tasks", (t) => {
  const env = laneFixture(t);
  env.store.settings.set("task_work_since", new Date(Date.now() - 60_000).toISOString());
  const task = env.create();
  env.crowd(CROWD);
  env.age(task.id);
  pickUpTasks(env.store, env.admit);
  assert.ok(started(env, task.id));
});

test("a stalled task behind hundreds of more recent open tasks is asked to go on", (t) => {
  const env = laneFixture(t);
  const task = env.worked();
  env.crowd(CROWD);
  env.age(task.id);
  const later = new Date(Date.now() + STALL_AFTER_MS + 60_000);
  assert.equal(reviveStalled(env.store, env.admit, later).revived, 1);
  assert.equal(env.admitted[0]?.origin?.kind, "stalled_task");
});
