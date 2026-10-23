import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import type { StopReason } from "./computer.ts";
import { computerWatchdog } from "./watchdog.ts";

const GIB = 1024 ** 3;

/** A running computer bound to Home, as the watchdog sees it. */
function fake(o: { free: number; control?: "agent" | "human"; watched?: boolean; lastActivity: number }) {
  const halted: StopReason[] = [];
  let phase = "running";
  return {
    halted,
    vm: {
      mayRun: () => true,
      watched: () => o.watched ?? false,
      lastActivity: () => o.lastActivity,
      status: async () => ({ phase, thread: "home", control: o.control ?? "agent" }) as never,
      halt: async (reason: StopReason) => {
        halted.push(reason);
        phase = "stopped";
      },
    },
    freeMemory: async () => o.free,
  };
}

test("the watchdog stops the computer when the host runs short of memory, and tells the owner", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const f = fake({ free: 0.5 * GIB, lastActivity: Date.now() });
    const dog = computerWatchdog({ store: env.core.store, vm: f.vm, freeMemory: f.freeMemory, everyMs: 3_600_000 });
    await dog.tick();
    await dog.stop();
    assert.deepEqual(f.halted, ["memory"]);
    const notice = env.core.store.messages
      .list("home")
      .flatMap((m) => m.parts)
      .find((p) => p.type === "notice" && p.code === "computer.stopped");
    assert.equal(notice?.type === "notice" && notice.vars?.variant, "memory");
    assert.ok(
      env.core.store.notifications
        .list({ unreadOnly: false, limit: 50 })
        .some((n) => n.title === "Computer" && /0\.5 GiB/.test(n.body)),
    );
  } finally {
    await env.core.close();
    env.cleanup();
  }
});

test("the watchdog stops an idle computer only after the owner's minutes, and never while it is in use", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    let clock = Date.now();
    const check = async (o: Parameters<typeof fake>[0]) => {
      const f = fake(o);
      const dog = computerWatchdog({
        store: env.core.store,
        vm: f.vm,
        freeMemory: f.freeMemory,
        everyMs: 3_600_000,
        now: () => clock,
      });
      await dog.tick();
      await dog.stop();
      return f.halted;
    };
    const used = clock;
    clock = used + 29 * 60_000;
    assert.deepEqual(await check({ free: 8 * GIB, lastActivity: used }), [], "before 30 minutes");
    clock = used + 31 * 60_000;
    assert.deepEqual(await check({ free: 8 * GIB, lastActivity: used, control: "human" }), [], "the owner has it");
    assert.deepEqual(await check({ free: 8 * GIB, lastActivity: used, watched: true }), [], "someone watches it");
    env.core.store.settings.write("computer", { idle_minutes: 0 });
    assert.deepEqual(await check({ free: 8 * GIB, lastActivity: used }), [], "idle stop turned off");
    env.core.store.settings.write("computer", { idle_minutes: 30 });
    assert.deepEqual(await check({ free: 8 * GIB, lastActivity: used }), ["idle"]);
  } finally {
    await env.core.close();
    env.cleanup();
  }
});
