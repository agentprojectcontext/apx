// The shutdown watchdog must be armed BEFORE anything that can throw.
//
// 2026-09-08: the daemon took a SIGTERM, something threw partway through the
// teardown, `uncaughtException` logged it and kept the process alive (by
// design), and the hard-stop timer — armed on the last line of the same
// function — was never reached. The daemon sat half torn down: answering
// /api/health, no longer logging, deaf to every later SIGTERM. `apx restart`
// reported "did not shut down in time" and only `kill -9` cleared it.
//
// Asserted on source order because the alternative is killing a real daemon in
// the suite. Order is the entire property: a watchdog after the risk is not a
// watchdog.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync("src/host/daemon/index.js", "utf8");
test("the hard-stop timer is armed before the teardown that can throw", () => {
  const armed = src.indexOf("shutdown grace period expired");
  const firstTeardown = src.indexOf("abortAllActiveTurns()");
  assert.ok(armed > 0, "the watchdog must exist at all");
  assert.ok(firstTeardown > 0);
  assert.ok(armed < firstTeardown,
    "the watchdog is armed AFTER the first thing that can throw — that is the bug it exists to prevent");
});

test("every teardown step is isolated, so one failure does not skip the rest", () => {
  for (const name of ["scheduler", "callbackReconciler", "eventsBridge", "plugins", "memory", "registries"]) {
    assert.match(src, new RegExp(`step\\("${name}"`),
      `${name} is torn down unguarded — a throw there abandons every step after it`);
  }
});

test("the watchdog clears the pid file, so the next restart does not chase a ghost", () => {
  const i = src.indexOf("shutdown grace period expired");
  const window = src.slice(i, i + 200);
  assert.match(window, /clearPid\(\)/);
  assert.match(window, /process\.exit\(1\)/);
});
