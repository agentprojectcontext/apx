import assert from "node:assert/strict";
import { test } from "node:test";
import { createGestureGate } from "./computer-gesture.ts";
import { createPointerQuitBarrier } from "./computer-quit.ts";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("quit remains prevented until the cancelled native child closes, including repeated quit requests", async () => {
  const gate = createGestureGate();
  const child = deferred();
  const exited = deferred();
  let signal: AbortSignal | undefined;
  const action = gate.run(async (context) => {
    signal = context.signal;
    await child.promise;
    return "late result";
  });
  const cancelled = assert.rejects(action, /cancelled/);
  let prevented = 0;
  let quits = 0;
  const event = {
    preventDefault: () => {
      prevented++;
    },
  };
  const quit = createPointerQuitBarrier(
    () => gate.drain(),
    () => {
      quits++;
      exited.resolve();
    },
  );
  quit(event);
  quit(event);
  assert.equal(signal?.aborted, true);
  assert.equal(prevented, 2);
  assert.equal(quits, 0);
  await assert.rejects(
    gate.run(async () => "new action"),
    /still finishing/,
  );
  child.resolve();
  await cancelled;
  await exited.promise;
  assert.equal(quits, 1);
  await assert.rejects(
    gate.run(async () => "late action"),
    /closing/,
  );
  quit(event);
  assert.equal(prevented, 2);
});

test("quit with no running gesture needs no asynchronous barrier", () => {
  const gate = createGestureGate();
  const quit = createPointerQuitBarrier(
    () => gate.drain(),
    () => assert.fail("no second quit is needed"),
  );
  quit({ preventDefault: () => assert.fail("idle quit must not be prevented") });
});
