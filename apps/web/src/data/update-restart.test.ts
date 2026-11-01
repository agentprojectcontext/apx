import assert from "node:assert/strict";
import { test } from "node:test";
import { RESTART_WAIT_MS, restartOutcome } from "./update-restart.ts";

const now = async () => {};

test("a restart the app refuses fails at once with its reason", async () => {
  assert.deepEqual(await restartOutcome(async () => ({ ok: false, error: "Nothing is ready" }), now), {
    phase: "failed",
    log: "Nothing is ready",
  });
  assert.deepEqual(
    await restartOutcome(async () => {
      throw new Error("Native request failed");
    }, now),
    { phase: "failed", log: "Native request failed" },
  );
});

test("an app that said it quits but is still here stops waiting after the wait", async () => {
  const waits: number[] = [];
  let release = () => {};
  const outcome = restartOutcome(
    async () => ({ ok: true }),
    (ms) => {
      waits.push(ms);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  );
  let settled = false;
  void outcome.then(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(waits, [RESTART_WAIT_MS]);
  release();
  assert.deepEqual(await outcome, { phase: "stalled" });
});

test("an older app that gives no answer, or a browser with no app, still stops waiting", async () => {
  assert.deepEqual(await restartOutcome(() => undefined, now), { phase: "stalled" });
  assert.deepEqual(await restartOutcome(undefined, now), { phase: "stalled" });
});
