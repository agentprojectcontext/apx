import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

type Callback = (error: Error | null, out: string, stderr: string) => void;
let finish: Callback = () => {};
let launches = 0;
let kills = 0;
let invokedArgs: string[] = [];
Object.assign(globalThis, {
  [Symbol.for("apx.test.legacy-process")]: (_file: string, args: string[], _options: unknown, callback: Callback) => {
    launches++;
    invokedArgs = args;
    finish = callback;
    return {
      kill: () => {
        kills++;
        return true;
      },
    };
  },
});
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "node:child_process")
      return {
        url: `data:text/javascript,${encodeURIComponent('export const execFile = (...args) => globalThis[Symbol.for("apx.test.legacy-process")](...args);')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { macDriver } = await import("./computer-mac.ts");
hooks.deregister();

test("legacy accessibility cancellation waits for subprocess close before settling", async () => {
  const controller = new AbortController();
  const before = kills;
  let settled = false;
  const result = macDriver.press("Acme", 10, 20, controller.signal);
  const rejected = assert.rejects(result, /cancelled.*uncertain.*do not retry/).then(() => {
    settled = true;
  });
  controller.abort();
  assert.equal(kills, before + 1);
  await Promise.resolve();
  assert.equal(settled, false);
  finish(null, "pressed AXButton", "");
  await rejected;
});

test("legacy accessibility never launches an already cancelled action", async () => {
  const controller = new AbortController();
  controller.abort();
  const before = launches;
  await assert.rejects(macDriver.press("Acme", 10, 20, controller.signal), /cancelled before delivery/);
  assert.equal(launches, before);
});

test("a physical click already cancelled never launches input", async () => {
  const controller = new AbortController();
  controller.abort();
  const before = launches;
  await assert.rejects(macDriver.click("Acme", 10, 20, controller.signal), /cancelled before delivery/);
  assert.equal(launches, before);
});

test("stop while waiting for the owner's mouse cancels the click before any input", async () => {
  const controller = new AbortController();
  const before = { launches, kills };
  const result = macDriver.click("Acme", 10, 20, controller.signal);
  const rejected = assert.rejects(result, /cancelled/);
  controller.abort();
  assert.equal(kills, before.kills + 1);
  finish(Object.assign(new Error("killed"), { killed: true }), "", "");
  await rejected;
  assert.equal(launches, before.launches + 1);
});

test("stop during the physical click lets it finish so the mouse button is released", async () => {
  const controller = new AbortController();
  const before = { launches, kills };
  const result = macDriver.click("Acme", 10, 20, controller.signal);
  finish(null, "idle", "");
  await new Promise((r) => setImmediate(r));
  assert.equal(launches, before.launches + 2);
  assert.deepEqual(invokedArgs.slice(-3), ["Acme", "10", "20"]);
  controller.abort();
  assert.equal(kills, before.kills);
  finish(null, "Acme", "");
  await result;
});

function accessibilityEnvironment(role: string, fail: boolean) {
  let effects = 0;
  const element = { role };
  const bridge = Object.assign((value: unknown) => value, {
    kCFBooleanTrue: true,
    AXUIElementCreateApplication: () => element,
    AXUIElementCopyElementAtPosition: (_app: unknown, _x: number, _y: number, out: { [key: number]: unknown }) => {
      out[0] = element;
      return 0;
    },
    AXUIElementCopyAttributeValue: (_element: unknown, name: string, out: { [key: number]: unknown }) => {
      out[0] = name === "AXRole" ? role : "Acme";
      return 0;
    },
    AXUIElementCopyActionNames: (_element: unknown, out: { [key: number]: unknown }) => {
      out[0] = ["AXPress"];
      return 0;
    },
    AXUIElementSetAttributeValue: (_element: unknown, name: string) => {
      if (name !== "AXFocused") return 0;
      effects++;
      return fail ? -1 : 0;
    },
    AXUIElementPerformAction: () => {
      effects++;
      return fail ? -1 : 0;
    },
  });
  return {
    effects: () => effects,
    sandbox: {
      $: bridge,
      Ref: () => ({}),
      ObjC: {
        import: () => {},
        castRefToObject: (v: unknown) => v,
        deepUnwrap: (v: unknown) => v,
        unwrap: (v: unknown) => v,
      },
      Application: () => ({ processes: { whose: () => () => [{ unixId: () => 7 }] } }),
      delay: () => {},
    },
  };
}

for (const role of ["AXButton", "AXTextField"]) {
  for (const fail of [false, true]) {
    test(`legacy ${role} materializes its process and never treats a delivered error as no action (${fail})`, async () => {
      const result = macDriver.press("Acme", 120, 130, new AbortController().signal);
      const rejected = fail ? assert.rejects(result, /outcome uncertain.*do not retry or fall back/) : undefined;
      const script = invokedArgs[3];
      assert.ok(script);
      const fixture = accessibilityEnvironment(role, fail);
      const run = () => runInNewContext(`${script}\nrun(["Acme", "120", "130"]);`, fixture.sandbox);
      if (fail) {
        assert.throws(run, /outcome uncertain.*do not retry or fall back/);
        finish(
          new Error("execution failed"),
          "",
          "execution error: accessibility outcome uncertain; do not retry or fall back",
        );
        await rejected;
      } else {
        const out = String(run());
        assert.match(out, /^(pressed|focused) /);
        finish(null, out, "");
        assert.equal(await result, out);
      }
      assert.equal(fixture.effects(), 1);
    });
  }
}
