import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { ComputerDriver } from "./computer-driver.ts";
import type { AgentCursor } from "./cursor.ts";

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent("export const systemPreferences = { isTrustedAccessibilityClient: () => true }; export const desktopCapturer = {}; export const screen = {}; export const shell = {}; export const app = {};")}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { createComputer } = await import("./computer.ts");
hooks.deregister();

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(visiblePress?: ComputerDriver["visiblePress"], legacyError?: Error) {
  const effects: string[] = [];
  let available = true;
  const driver: ComputerDriver = {
    front: async () => ({ app: "Acme", pid: 1, window: "Test", bounds: undefined, lines: [] }),
    activate: async () => {
      effects.push("activate");
    },
    topAt: async () => undefined,
    open: async () => {},
    canPress: () => true,
    key: async () => "Acme",
    press: async () => {
      effects.push("legacy press");
      if (legacyError) throw legacyError;
      return "pressed AXButton";
    },
    click: async () => {
      effects.push("physical click");
    },
    insert: async () => true,
    paste: async () => {},
    ...(visiblePress ? { visiblePress } : {}),
  };
  const cursor: AgentCursor = {
    moveTo: async () => {
      effects.push("overlay arrow");
    },
    hide: () => {
      effects.push("hide overlay");
    },
    pulse: () => {},
    say: () => {},
    close: () => {},
  };
  const computer = createComputer({
    cursor,
    driver,
    available: () => available,
    onActivity: () => effects.push("activity"),
    onStopped: () => {},
  });
  const params = { app: "Acme", x: -200, y: 120, pointer: "visible" };
  return {
    computer,
    driver,
    cursor,
    effects,
    params,
    off: () => {
      available = false;
      computer.cancelPointer();
    },
  };
}

test("visible mode awaits the overlay and uses only the cancelable driver", async () => {
  const s = setup(async (app, x, y, signal) => {
    assert.equal(app, "Acme");
    assert.deepEqual([x, y], [-200, 120]);
    assert.equal(signal.aborted, false);
    return "visible pointer; pressed AXButton";
  });
  assert.deepEqual(await s.computer.handle("computer.click", s.params), {
    app: "Acme",
    how: "visible pointer; pressed AXButton",
  });
  assert.deepEqual(s.effects, ["overlay arrow", "activity"]);
});

test("visible mode waits for the labeled overlay before delivery and stop cancels that wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const moved = deferred();
  let deliveries = 0;
  const s = setup(async () => {
    deliveries++;
    return "pressed";
  });
  s.cursor.moveTo = (x, y, label) => {
    assert.deepEqual([x, y, label], [-200, 120, "Acme agent"]);
    return moved.promise;
  };
  const action = s.computer.handle("computer.click", { ...s.params, note: "Acme agent" });
  const rejected = assert.rejects(action, /cancelled/);
  assert.equal(deliveries, 0);
  s.computer.stop();
  moved.resolve();
  await rejected;
  assert.equal(deliveries, 0);
  assert.deepEqual(s.effects, ["hide overlay"]);
});

test("unsupported visible mode never moves the overlay or invokes a legacy fallback", async () => {
  const s = setup();
  await assert.rejects(s.computer.handle("computer.click", s.params), /unsupported/);
  assert.deepEqual(s.effects, []);
});

test("uncertain delivery is not retried and does not fall back", async () => {
  let calls = 0;
  const s = setup(async () => {
    calls++;
    throw new Error("press outcome uncertain; do not retry");
  });
  await assert.rejects(s.computer.handle("computer.click", s.params), /outcome uncertain/);
  assert.equal(calls, 1);
  assert.deepEqual(s.effects, ["overlay arrow"]);
});

test("stop cannot be undone by its rearm timer while an old process is draining", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const closed = deferred();
  const entered = deferred();
  let signal: AbortSignal | undefined;
  const s = setup(async (_app, _x, _y, value) => {
    signal = value;
    entered.resolve();
    await closed.promise;
    return "pressed";
  });
  const action = s.computer.handle("computer.click", s.params);
  const cancelled = assert.rejects(action, /outcome uncertain.*do not retry/);
  await entered.promise;
  s.computer.stop();
  assert.equal(signal?.aborted, true);
  t.mock.timers.tick(3000);
  await assert.rejects(s.computer.handle("computer.key", { app: "Acme", keys: "enter" }), /still finishing/);
  closed.resolve();
  await cancelled;
  assert.equal(s.effects.includes("activity"), false);
});

test("off or disconnect cancels before allowing a late success report", async () => {
  const closed = deferred();
  const entered = deferred();
  let signal: AbortSignal | undefined;
  const s = setup(async (_a, _x, _y, value) => {
    signal = value;
    entered.resolve();
    await closed.promise;
    return "pressed";
  });
  const action = s.computer.handle("computer.click", s.params);
  const cancelled = assert.rejects(action, /outcome uncertain.*do not retry/);
  await entered.promise;
  s.off();
  assert.equal(signal?.aborted, true);
  closed.resolve();
  await cancelled;
  await assert.rejects(s.computer.handle("computer.click", s.params), /off or disconnected/);
  assert.equal(s.effects.includes("activity"), false);
});

test("an uncertain legacy accessibility press must not become a second physical action", async () => {
  const s = setup(undefined, new Error("press outcome uncertain"));
  await assert.rejects(s.computer.handle("computer.click", { app: "Acme", x: 10, y: 20 }), /outcome uncertain/);
  assert.deepEqual(s.effects, ["overlay arrow", "legacy press"]);
});

test("default labels describe click and typing actions without a supplied note", async () => {
  const s = setup(async () => "pressed AXButton");
  const labels: string[] = [];
  s.cursor.moveTo = async (_x, _y, label) => {
    labels.push(label ?? "");
  };
  s.cursor.say = (label) => {
    labels.push(label);
  };
  await s.computer.handle("computer.click", s.params);
  await s.computer.handle("computer.type", { app: "Acme", text: "Example" });
  assert.deepEqual(labels, ["Click in Acme", "Typing in Acme"]);
});

test("disabled physical fallback refuses without activation, input or successful activity", async () => {
  const s = setup();
  s.driver.physicalClickSupported = false;
  s.driver.press = async () => {
    s.effects.push("legacy press");
    return "none: no supported action";
  };
  await assert.rejects(
    s.computer.handle("computer.click", { app: "Acme", x: 10, y: 20 }),
    /physical mouse fallback is disabled/,
  );
  assert.deepEqual(s.effects, ["overlay arrow", "legacy press"]);
});

test("legacy click remains on its original path when pointer is absent", async () => {
  const s = setup(async () => {
    throw new Error("must not call visible mode");
  });
  assert.deepEqual(await s.computer.handle("computer.click", { app: "Acme", x: 10, y: 20 }), {
    app: "Acme",
    how: "pressed AXButton",
  });
  assert.deepEqual(s.effects, ["overlay arrow", "legacy press", "activity"]);
});

test("overlapping legacy clicks are rejected before either can restore the other's pointer", async () => {
  const s = setup();
  const released = deferred();
  const entered = deferred();
  s.driver.press = async () => "none";
  let clicks = 0;
  s.driver.click = async () => {
    clicks++;
    entered.resolve();
    if (clicks === 1) await released.promise;
  };
  const params = { app: "Acme", x: 10, y: 20 };
  const first = s.computer.handle("computer.click", params);
  await entered.promise;
  try {
    await assert.rejects(s.computer.handle("computer.click", params), /still finishing/);
    assert.equal(s.effects.filter((effect) => effect === "overlay arrow").length, 1);
  } finally {
    released.resolve();
    await first;
  }
  assert.equal(s.effects.filter((effect) => effect === "activity").length, 1);
});

test("stop cancels a legacy click queued behind the overlay even after rearming", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  const released = deferred();
  s.cursor.moveTo = () => released.promise;
  const action = s.computer.handle("computer.click", { app: "Acme", x: 10, y: 20 });
  const rejected = assert.rejects(action, /cancelled/);
  s.computer.stop();
  t.mock.timers.tick(3000);
  released.resolve();
  await rejected;
  assert.deepEqual(s.effects, ["hide overlay"]);
});

test("stop aborts an in-flight legacy driver and keeps the gate until it closes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  const entered = deferred();
  const released = deferred();
  let signal: AbortSignal | undefined;
  s.driver.press = async () => "none";
  s.driver.click = async (_app, _x, _y, value) => {
    signal = value;
    entered.resolve();
    await released.promise;
  };
  const action = s.computer.handle("computer.click", { app: "Acme", x: 10, y: 20 });
  // The driver finishes its click after the stop: delivered, so reported as such and never retried.
  const rejected = assert.rejects(action, /clicked just as computer use stopped; do not retry/);
  await entered.promise;
  s.computer.stop();
  assert.equal(signal?.aborted, true);
  t.mock.timers.tick(3000);
  await assert.rejects(s.computer.handle("computer.key", { app: "Acme", keys: "enter" }), /still finishing/);
  released.resolve();
  await rejected;
  assert.equal(s.effects.includes("activity"), false);
});

test("disconnect during an accessibility press cancels it without physical fallback", async () => {
  const s = setup();
  const entered = deferred();
  const released = deferred();
  let signal: AbortSignal | undefined;
  s.driver.press = async (_app, _x, _y, value) => {
    signal = value;
    entered.resolve();
    await released.promise;
    return "none";
  };
  const action = s.computer.handle("computer.click", { app: "Acme", x: 10, y: 20 });
  const rejected = assert.rejects(action, /cancelled/);
  await entered.promise;
  s.off();
  assert.equal(signal?.aborted, true);
  released.resolve();
  await rejected;
  assert.deepEqual(s.effects, ["overlay arrow", "hide overlay"]);
});
