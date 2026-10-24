import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  assertPath,
  autoAdvance,
  manualTimers,
  removeDir,
  scaled,
  sleepOn,
  stopped,
  tempDir,
  waitFor,
} from "./platform.ts";

test("waitFor returns what the check found, and fails on wall-clock time, not on a number of tries", async () => {
  let calls = 0;
  assert.equal(await waitFor(() => ++calls >= 3 && "found", "the third call"), "found");
  const started = performance.now();
  await assert.rejects(
    waitFor(() => false, "nothing", { ms: 100, every: 1 }),
    /timed out after \d+ ms waiting for nothing/,
  );
  assert.ok(performance.now() - started >= scaled(100) - 5);
});

test("a folder Windows still holds is removed once it lets go; any other failure is not waited out", async (t) => {
  const dir = tempDir("apx-platform-");
  fs.writeFileSync(path.join(dir.path, "a.txt"), "x");
  const rm = fs.promises.rm;
  let attempts = 0;
  // What a Windows runner does while a child that just exited still has the folder open.
  t.mock.method(fs.promises, "rm", async (...args: Parameters<typeof rm>) => {
    if (++attempts <= 3) throw Object.assign(new Error("EPERM, Permission denied"), { code: "EPERM" });
    return rm(...args);
  });
  await dir.remove();
  assert.equal(attempts, 4);
  assert.equal(fs.existsSync(dir.path), false);
  attempts = 0;
  t.mock.method(fs.promises, "rm", async () => {
    attempts++;
    throw Object.assign(new Error("EINVAL"), { code: "EINVAL" });
  });
  await assert.rejects(removeDir(dir.path), /EINVAL/);
  assert.equal(attempts, 1);
});

test("stopped settles when the child exits, and at once for one that already has", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 50)"], { stdio: "ignore" });
  await stopped(child);
  assert.notEqual(child.exitCode, null);
  await stopped(child);
});

test("a manual clock fires timers in order only when told, and moves on by itself while a fixture sleeps", async () => {
  const timers = manualTimers();
  const fired: string[] = [];
  timers.after(200, () => fired.push("b"));
  const cancel = timers.after(150, () => fired.push("never"));
  timers.after(100, () => fired.push("a"));
  cancel();
  timers.tick(99);
  assert.deepEqual(fired, []);
  timers.tick(101);
  assert.deepEqual(fired, ["a", "b"]);
  let sleeping = 0;
  const stop = autoAdvance(timers, { waiting: () => sleeping > 0 });
  try {
    const start = timers.now();
    sleeping++;
    await sleepOn(timers, 60_000);
    sleeping--;
    assert.equal(timers.now() - start, 60_000);
    const aborted = new AbortController();
    const late = sleepOn(timers, 1000, aborted.signal);
    aborted.abort(new Error("stopped"));
    await assert.rejects(late, /stopped/);
    assert.equal(timers.pending(), 0);
  } finally {
    stop();
  }
});

test("paths are asserted as the system compares them", () => {
  const dir = tempDir("apx-platform-");
  try {
    assertPath(path.join(dir.path, "x", ".."), dir.path);
    assert.throws(() => assertPath(`${dir.path}-other`, dir.path));
    assert.throws(() => assertPath(undefined, dir.path));
  } finally {
    fs.rmdirSync(dir.path);
  }
});
