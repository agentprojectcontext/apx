import assert from "node:assert/strict";
import { test } from "node:test";
import { manualTimers } from "../testkit/platform.ts";
import { READY_POLL_MS, READY_WAIT_MS, type ReadyEvent, readyWaiters } from "./ready.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("an agent waiting on the computer hears once when it is ready, never while it starts", async () => {
  const timers = manualTimers();
  let phase = "preparing";
  const heard: ReadyEvent[] = [];
  const w = readyWaiters({ phase: async () => ({ phase }), wake: (e) => heard.push(e), timers });
  w.add("thr_1", "scout");
  timers.tick(READY_POLL_MS);
  await flush();
  assert.deepEqual(heard, []);
  phase = "running";
  timers.tick(READY_POLL_MS);
  await flush();
  assert.deepEqual(heard, [{ thread: "thr_1", agent: "scout", ready: true }]);
  timers.tick(READY_POLL_MS * 5);
  await flush();
  assert.equal(heard.length, 1);
  assert.equal(timers.pending(), 0, "nothing polls once nobody waits");
});

test("a start that fails, or never ends, is told to the agent with why", async () => {
  const timers = manualTimers();
  const heard: ReadyEvent[] = [];
  let state: { phase: string; error?: string } = { phase: "error", error: "Lima did not start" };
  const w = readyWaiters({ phase: async () => state, wake: (e) => heard.push(e), timers });
  w.add("thr_1", "scout");
  timers.tick(READY_POLL_MS);
  await flush();
  assert.deepEqual(heard, [{ thread: "thr_1", agent: "scout", ready: false, error: "Lima did not start" }]);

  state = { phase: "preparing" };
  w.add("thr_2", "roby");
  for (let waited = 0; waited <= READY_WAIT_MS; waited += READY_POLL_MS) {
    timers.tick(READY_POLL_MS);
    await flush();
  }
  assert.deepEqual(heard.at(-1), { thread: "thr_2", agent: "roby", ready: false, error: "it did not start in time" });
  w.close();
});
