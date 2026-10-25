import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { keepAwake, SLEEP_GAP_MS, sleepWatch } from "./awake.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

function spawner() {
  const spawned: { args: string[]; killed: boolean; child: EventEmitter & { kill(): boolean; exitCode: null } }[] = [];
  const spawn = (_cmd: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      kill() {
        entry.killed = true;
        return true;
      },
    });
    const entry = { args, killed: false, child };
    spawned.push(entry);
    return child;
  };
  return { spawned, spawn };
}

test("the Mac is kept awake while work runs, let go when none does, and never left held by a closed core", () => {
  let busy = false;
  let enabled = true;
  const { spawned, spawn } = spawner();
  const awake = keepAwake({ busy: () => busy, enabled: () => enabled, platform: "darwin", pid: 4242, spawn });
  awake.update();
  assert.equal(spawned.length, 0, "nothing to do: the Mac may sleep");
  busy = true;
  awake.update();
  awake.update();
  assert.deepEqual(
    spawned.map((s) => s.args),
    [["-i", "-w", "4242"]],
    "held once, tied to the core's pid",
  );
  busy = false;
  awake.update();
  assert.equal(spawned[0]?.killed, true);
  busy = true;
  awake.update();
  awake.close();
  assert.equal(spawned[1]?.killed, true, "the core's shutdown lets it go");
  awake.update();
  assert.equal(spawned.length, 2);

  // Off by the owner, or another platform: never held.
  const off = spawner();
  enabled = false;
  keepAwake({ busy: () => true, enabled: () => enabled, platform: "darwin", spawn: off.spawn }).update();
  keepAwake({ busy: () => true, enabled: () => true, platform: "linux", spawn: off.spawn }).update();
  assert.equal(off.spawned.length, 0);
});

/** A clock that can run on time, or sleep: it jumps ahead and the timers due meanwhile all fire late, at wake. */
function sleepyTimers() {
  let now = 1_000_000;
  const pending: { at: number; fn: () => void }[] = [];
  const fireDue = () => {
    for (;;) {
      pending.sort((a, b) => a.at - b.at);
      const next = pending[0];
      if (!next || next.at > now) return;
      pending.shift();
      next.fn();
    }
  };
  return {
    now: () => now,
    after(ms: number, fn: () => void) {
      const entry = { at: now + ms, fn };
      pending.push(entry);
      return () => {
        const at = pending.indexOf(entry);
        if (at >= 0) pending.splice(at, 1);
      };
    },
    /** Awake: every timer fires when due. */
    run(ms: number) {
      const end = now + ms;
      for (;;) {
        pending.sort((a, b) => a.at - b.at);
        const next = pending[0];
        if (!next || next.at > end) break;
        now = next.at;
        pending.shift();
        next.fn();
      }
      now = end;
    },
    /** Asleep: nothing fires until it wakes, `ms` later. */
    sleep(ms: number) {
      now += ms;
    },
    wake: fireDue,
  };
}

test("a tick that comes 30 s late means the Mac slept, and only a sleep since then counts", () => {
  const timers = sleepyTimers();
  const watch = sleepWatch(timers, 10_000);
  const start = timers.now();
  timers.run(60_000);
  assert.equal(watch.sleptSince(start), false, "ticks on time: awake");
  const before = timers.now();
  timers.sleep(SLEEP_GAP_MS + 20_000);
  // Woken, before the overdue tick runs (a deadline may fire first): it already counts.
  assert.equal(watch.sleptSince(before), true, "overdue now: it just slept");
  timers.wake();
  assert.equal(watch.sleptSince(before), true, "the late tick recorded the gap");
  timers.run(60_000);
  assert.equal(watch.sleptSince(timers.now() - 1), false, "a later window saw no sleep");
  watch.close();
});

/** A model that answers only once the test lets it, so a turn stays working as long as the test needs. */
function heldModel() {
  const answers: (() => void)[] = [];
  const llm = scriptedLlm(() => new Promise((resolve) => answers.push(() => resolve(say("Listo")))));
  return { llm, waiting: () => answers.length, answer: () => answers.shift()?.() };
}

for (const on of [true, false])
  test(`a core's working turn ${on ? "holds the Mac awake until it ends" : "never holds it once the owner turned it off"}`, async () => {
    const model = heldModel();
    const { spawned, spawn } = spawner();
    const env = await startCore({ llm: model.llm, keepAwake: spawn });
    try {
      const prefs = await env.client.call("desktop.get", {});
      await env.client.call("desktop.set", { ...prefs, keep_awake: on });
      await env.client.call("threads.send", { thread: "home", text: "Hola" });
      await waitFor(() => model.waiting() > 0, "the model call");
      if (on) await waitFor(() => spawned.length === 1, "the hold");
      assert.equal(spawned.length, on ? 1 : 0);
      assert.deepEqual(spawned[0]?.args.slice(0, 2), on ? ["-i", "-w"] : undefined);
      model.answer();
      await waitFor(() => env.core.store.runs.list("home", 1)[0]?.ended_at, "the run's end");
      if (on) await waitFor(() => spawned[0]?.killed, "the release");
      assert.equal(spawned.length, on ? 1 : 0, "one hold for the whole turn");
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
