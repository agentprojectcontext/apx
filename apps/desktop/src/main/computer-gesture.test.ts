import assert from "node:assert/strict";
import { test } from "node:test";
import { createGestureGate } from "./computer-gesture.ts";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("only one gesture can run, including while cancellation is draining", async () => {
  const gate = createGestureGate();
  const closed = deferred();
  let delivered = 0;
  const first = gate.run(async ({ signal, check }) => {
    await closed.promise;
    assert.equal(signal.aborted, true);
    check();
    delivered++;
  });
  const cancelled = assert.rejects(first, /cancelled/);
  gate.invalidate();
  await assert.rejects(
    gate.run(async () => delivered++),
    /still finishing/,
  );
  assert.equal(delivered, 0);
  closed.resolve();
  await cancelled;
  assert.equal(await gate.run(async () => ++delivered), 1);
});

test("invalidation between stages prevents delivery even after a later request", async () => {
  const gate = createGestureGate();
  const moved = deferred();
  const deliver = deferred();
  const effects: string[] = [];
  const first = gate.run(async ({ check }) => {
    moved.resolve();
    await deliver.promise;
    check();
    effects.push("click");
  });
  const cancelled = assert.rejects(first, /cancelled/);
  await moved.promise;
  gate.invalidate();
  gate.invalidate();
  await assert.rejects(
    gate.run(async () => effects.push("other")),
    /still finishing/,
  );
  deliver.resolve();
  await cancelled;
  await gate.run(async ({ check, signal }) => {
    assert.equal(signal.aborted, false);
    check();
    effects.push("new gesture");
  });
  assert.deepEqual(effects, ["new gesture"]);
});

test("a late result cannot turn a cancelled action into success", async () => {
  const gate = createGestureGate();
  const closed = deferred();
  const action = gate.run(async () => {
    await closed.promise;
    return "pressed";
  });
  const cancelled = assert.rejects(action, /already delivered cannot be withdrawn; do not retry/);
  gate.invalidate();
  closed.resolve();
  await cancelled;
});

test("operation errors propagate without retry and release the slot after settling", async () => {
  const gate = createGestureGate();
  let attempts = 0;
  await assert.rejects(
    gate.run(async () => {
      attempts++;
      throw new Error("delivery uncertain");
    }),
    /delivery uncertain/,
  );
  assert.equal(attempts, 1);
  assert.equal(await gate.run(async () => "next"), "next");
});

test("synchronous failure and cancellation of an idle gate do not poison future gestures", async () => {
  const gate = createGestureGate();
  gate.invalidate();
  await assert.rejects(
    gate.run(() => {
      throw new Error("invalid target");
    }),
    /invalid target/,
  );
  assert.equal(await gate.run(async () => "ready"), "ready");
});
