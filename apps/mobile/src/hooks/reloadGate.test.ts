import assert from "node:assert/strict";
import { test } from "node:test";
import { type GateTimers, reloadGate } from "./reloadGate.ts";

function manualTimers() {
  const due = new Map<number, () => void>();
  let next = 0;
  const timers: GateTimers = {
    set: (run) => {
      due.set(++next, run);
      return next;
    },
    clear: (handle) => void due.delete(handle as number),
  };
  const fire = () => {
    const runs = [...due.values()];
    due.clear();
    for (const run of runs) run();
  };
  return { timers, fire, pending: () => due.size };
}

function slowReload() {
  let active = 0;
  let most = 0;
  let started = 0;
  const finish: Array<() => void> = [];
  const run = () => {
    started++;
    active++;
    most = Math.max(most, active);
    return new Promise<void>((resolve) =>
      finish.push(() => {
        active--;
        resolve();
      }),
    );
  };
  const settle = async () => {
    finish.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { run, settle, stats: () => ({ started, most }) };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("events while a slow reload runs never start a second one beside it, and fold into one more after it", async () => {
  const clock = manualTimers();
  const reload = slowReload();
  const gate = reloadGate(reload.run, 3000, clock.timers);
  void gate.now();
  await tick();
  for (let i = 0; i < 50; i++) {
    gate.later();
    clock.fire();
    void gate.now();
  }
  await tick();
  assert.deepEqual(reload.stats(), { started: 1, most: 1 });
  await reload.settle();
  assert.equal(clock.pending(), 1);
  clock.fire();
  await tick();
  assert.deepEqual(reload.stats(), { started: 2, most: 1 });
  await reload.settle();
  assert.equal(clock.pending(), 0);
});

test("asks between two reloads become one reload after the gap", async () => {
  const clock = manualTimers();
  const reload = slowReload();
  const gate = reloadGate(reload.run, 3000, clock.timers);
  for (let i = 0; i < 20; i++) gate.later();
  assert.equal(clock.pending(), 1);
  assert.equal(reload.stats().started, 0);
  clock.fire();
  await tick();
  assert.equal(reload.stats().started, 1);
});

test("now joins the reload in flight and a failed reload frees the gate", async () => {
  const clock = manualTimers();
  let calls = 0;
  const gate = reloadGate(
    async () => {
      calls++;
      if (calls === 1) throw new Error("Core unavailable");
    },
    3000,
    clock.timers,
  );
  const first = gate.now();
  assert.equal(gate.now(), first);
  await assert.rejects(first, /Core unavailable/);
  assert.equal(gate.busy(), false);
  clock.fire();
  await tick();
  assert.equal(calls, 2);
});

test("a stopped gate starts nothing more", async () => {
  const clock = manualTimers();
  const reload = slowReload();
  const gate = reloadGate(reload.run, 3000, clock.timers);
  gate.later();
  gate.stop();
  assert.equal(clock.pending(), 0);
  await gate.now();
  gate.later();
  assert.equal(reload.stats().started, 0);
});
