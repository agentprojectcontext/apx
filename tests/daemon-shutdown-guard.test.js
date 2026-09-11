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
  // The drain is the first thing the shutdown does now — it used to be the
  // abort this drain replaced. Same property, later marker.
  const firstTeardown = src.indexOf("drainActiveTurns()");
  assert.ok(armed > 0, "the watchdog must exist at all");
  assert.ok(firstTeardown > 0);
  assert.ok(armed < firstTeardown,
    "the watchdog is armed AFTER the first thing that can throw — that is the bug it exists to prevent");
});

// The drain and the watchdog are one mechanism split across two processes, and
// the only thing holding it together is the ORDER of three numbers. Nothing
// else in the suite would notice them crossing: every symptom shows up as a
// daemon killed mid-drain, or as `apx restart` declaring failure over a healthy
// shutdown — both of which need a real daemon and a real long turn to observe.
test("the shutdown ceilings stay in order", async () => {
  const { DRAIN_MS, SETTLE_MS, SHUTDOWN_GRACE_MS, PORT_RELEASE_WAIT_MS } =
    await import("#core/constants/shutdown.js");
  assert.ok(SHUTDOWN_GRACE_MS > DRAIN_MS + SETTLE_MS,
    "the watchdog fires during the drain — it would kill the turns the drain exists to save");
  assert.ok(PORT_RELEASE_WAIT_MS > SHUTDOWN_GRACE_MS,
    "`apx restart` gives up before the daemon's own hard stop — it would report failure over a daemon that was about to exit");
});

test("the CLI derives its wait from the daemon's ceiling instead of guessing", () => {
  const cli = fs.readFileSync("src/interfaces/cli/commands/daemon.js", "utf8");
  assert.match(cli, /PORT_RELEASE_WAIT_MS/,
    "a hardcoded wait here drifts from the daemon's grace period the next time the drain changes");
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
