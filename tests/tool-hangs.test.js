// Turns that stop answering, and what a person can do about it.
//
// Reported from the outside on 2026-09-18: an action "hangs waiting and will
// not let you interrupt or cancel", with `run_shell` on Windows named as the
// case. Three separate defects sit under that sentence and each gets its own
// section here.
//
//   1. THE SHELL THAT IS NOT THERE. `sh -lc` was hardcoded. On Windows there is
//      no `sh`, so every call failed to spawn — and with no `error` listener
//      the thrown ENOENT pre-empted the `close` that would have settled the
//      promise, so the turn waited forever.
//   2. NO CEILING ON ONE CALL. Nothing in the loop bounded a single handler, so
//      (1) could not be survived even in principle.
//   3. STOP DID NOT REACH A RUNNING TOOL. The abort signal was only read
//      between iterations, so cancelling during a long call did nothing until
//      the call returned on its own.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-hang-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // APX_HOME, not HOME alone

const { shellCommand, killChild } = await import("#core/util/shell.js");
const { runToolWithWatchdog, resolveToolDeadline, TOOL_DEADLINE_MS } =
  await import("#core/agent/loop/tool-watchdog.js");
const runShell = (await import("#core/agent/tools/handlers/run-shell.js")).default;

// Hold the event loop open for as long as this file runs.
//
// The watchdog unref()s both of its timers on purpose — a hang detector must
// never be the thing keeping a process alive (tool-watchdog.js). The cost of
// that lands here: a test awaiting a handler that never settles has nothing
// ref'd pending, so Node is free to exit cleanly in the middle of it.
//
// When it does, every test still queued is reported as "Promise resolution is
// still pending but the event loop has already resolved" — INCLUDING the
// synchronous ones (`resolveToolDeadline`), and that is the tell: a test with
// no promise in it cannot fail that way, so what went away was the process,
// not any single test. Run 35489025270 lost all twelve like that on
// 2026-09-20 while this file passed 23/23 locally, which is the shape of the
// bug: it depends on whether anything else happens to be pending, so it is
// green until the day it is not.
//
// One ref'd handle removes the choice. It changes nothing being tested.
const keepAlive = setInterval(() => {}, 60_000);
after(() => clearInterval(keepAlive));

function projectsStub(root) {
  const rec = { id: "1", name: "tmp", path: root, storagePath: root };
  return { list: () => [rec], get: () => rec, rebuild: () => {} };
}

const allow = async () => {};

// ---------------------------------------------------------------------------
// 1. the shell that is not there
// ---------------------------------------------------------------------------

test("POSIX gets a login shell, so the daemon's bare launchd PATH is repaired", () => {
  const { file, args, options } = shellCommand("echo hi", { login: true, platform: "darwin" });
  assert.equal(file, "sh");
  assert.deepEqual(args, ["-lc", "echo hi"]);
  assert.deepEqual(options, {});
});

test("a routine hook keeps the plain -c it has always had", () => {
  const { args } = shellCommand("echo hi", { platform: "linux" });
  assert.deepEqual(args, ["-c", "echo hi"]);
});

test("Windows gets cmd.exe in the form Node's own exec uses", () => {
  const { file, args, options } = shellCommand('echo "hi there"', {
    platform: "win32",
    env: { ComSpec: "C:\\Windows\\system32\\cmd.exe" },
  });
  assert.equal(file, "C:\\Windows\\system32\\cmd.exe");
  // /d skips registry AutoRun, /s plus the wrapping quotes give cmd its
  // documented "strip the outer pair, take the rest literally" rule — which is
  // what stops a command containing quotes from being mangled.
  assert.deepEqual(args, ["/d", "/s", "/c", '"echo "hi there""']);
  assert.equal(options.windowsVerbatimArguments, true);
});

test("Windows without ComSpec still names a shell rather than nothing", () => {
  assert.equal(shellCommand("dir", { platform: "win32", env: {} }).file, "cmd.exe");
});

test("the login flag is ignored on Windows, which has no equivalent", () => {
  const a = shellCommand("dir", { platform: "win32", env: {}, login: true });
  const b = shellCommand("dir", { platform: "win32", env: {}, login: false });
  assert.deepEqual(a.args, b.args);
});

// The regression, and the one that mattered most. Run against the pre-fix
// handler (2026-09-19) this call NEVER RETURNS: the unlistened `error` event is
// thrown from inside the tick that would have emitted `close`, so nothing ever
// settles the promise. The test fails by timing out rather than by assertion,
// which is the honest shape for the bug it guards.
test("a command that could not START is an error, not an empty success", async () => {
  const missing = path.join(TMP_HOME, "gone-" + Date.now());
  const handler = runShell.makeHandler({
    projects: projectsStub(missing),
    requirePermission: allow,
  });
  const out = await handler({ command: "echo hi" });
  assert.ok(out.error, `expected an error, got ${JSON.stringify(out)}`);
  assert.match(out.error, /could not be started/);
  assert.equal(out.exit_code, undefined, "an exit code would imply it ran");
});

test("a command that really runs still reports normally", async () => {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const handler = runShell.makeHandler({ projects: projectsStub(root), requirePermission: allow });
  const out = await handler({ command: "echo hi" });
  assert.equal(out.exit_code, 0);
  assert.equal(out.stdout.trim(), "hi");
  assert.equal(out.error, undefined);
});

test("killChild escalates to SIGKILL when SIGTERM is ignored", async () => {
  const signals = [];
  const fake = { pid: 4242, kill: (s) => signals.push(s) };
  const cancel = killChild(fake, { graceMs: 20 });
  assert.deepEqual(signals, ["SIGTERM"]);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  cancel();
});

test("cancelling the escalation stops a finished child being SIGKILLed", async () => {
  const signals = [];
  const cancel = killChild({ pid: 1, kill: (s) => signals.push(s) }, { graceMs: 20 });
  cancel();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(signals, ["SIGTERM"]);
});

// ---------------------------------------------------------------------------
// 2. a ceiling on one call
// ---------------------------------------------------------------------------

test("a handler that answers is passed straight through", async () => {
  const out = await runToolWithWatchdog(async () => ({ ok: 1 }), { name: "t", deadlineMs: 1000 });
  assert.deepEqual(out, { ok: 1 });
});

test("a handler that throws still throws — the loop turns that into a tool error", async () => {
  await assert.rejects(
    () => runToolWithWatchdog(async () => { throw new Error("boom"); }, { name: "t", deadlineMs: 1000 }),
    /boom/
  );
});

test("a handler that never settles is given up on, and says so honestly", async () => {
  const out = await runToolWithWatchdog(() => new Promise(() => {}), {
    name: "run_shell",
    deadlineMs: 40,
    slowMs: 0,
  });
  assert.equal(out.timed_out, true);
  // The wording matters: nothing here can stop the work, so a result that
  // implied cancellation would invite the model to simply run it again.
  assert.match(out.error, /NOT CANCELLED/);
  assert.match(out.error, /run_shell/);
});

test("a late rejection after the deadline does not become an unhandled rejection", async () => {
  let reject;
  const out = await runToolWithWatchdog(() => new Promise((_, r) => { reject = r; }), {
    name: "t",
    deadlineMs: 30,
    slowMs: 0,
  });
  assert.equal(out.timed_out, true);
  reject(new Error("late"));
  // If the racer's rejection were unhandled, the process would report it before
  // this test finishes.
  await new Promise((r) => setTimeout(r, 30));
});

test("the slow mark reports and gets out of the way — it does not end the call", async () => {
  const seen = [];
  // Whether the call had already finished when the mark fired. This is the
  // contract — "reports and gets out of the way" means it reports DURING the
  // call — and unlike a clock reading it is decided by ordering, not by timing.
  let finished = false;
  const out = await runToolWithWatchdog(
    () => new Promise((r) => setTimeout(() => { finished = true; r({ ok: 1 }); }, 60)),
    { name: "call_mcp", deadlineMs: 5000, slowMs: 10, onSlow: (i) => seen.push({ ...i, finished }) }
  );
  assert.deepEqual(out, { ok: 1 }, "a slow tool is not a failed tool");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tool, "call_mcp");
  assert.equal(seen[0].finished, false, "it reported while the call was still running");
  // This used to assert `elapsed_ms >= slowMs` and went red on CI and nowhere
  // else. The real defect was upstream: the watchdog measured the duration with
  // `Date.now()`, a wall clock that an NTP correction can step backwards, so
  // the elapsed it reported was not guaranteed to be a duration at all. That is
  // fixed at the source (tool-watchdog.js now uses a monotonic clock).
  //
  // The assertion is still not written as `>= slowMs`. Firing at exactly the
  // mark is not the contract — reporting while the call is still running is,
  // and that is the line above, decided by ordering instead of by arithmetic on
  // a clock. This one only holds it to being a real measurement.
  assert.ok(Number.isFinite(seen[0].elapsed_ms), "it says how long it has been waiting");
  assert.ok(seen[0].elapsed_ms >= 0, "a duration never runs backwards");
});

test("a failure inside the reporter cannot become a tool failure", async () => {
  const out = await runToolWithWatchdog(
    () => new Promise((r) => setTimeout(() => r("fine"), 40)),
    { name: "t", deadlineMs: 5000, slowMs: 5, onSlow: () => { throw new Error("feed down"); } }
  );
  assert.equal(out, "fine");
});

test("the slow mark stays quiet for a tool whose whole budget is shorter than it", async () => {
  const seen = [];
  await runToolWithWatchdog(() => new Promise(() => {}), {
    name: "t", deadlineMs: 30, slowMs: 60_000, onSlow: () => seen.push(1),
  });
  assert.equal(seen.length, 0);
});

test("a tool with no declared ceiling gets the generous default", () => {
  assert.equal(resolveToolDeadline({}, {}), TOOL_DEADLINE_MS);
  assert.equal(resolveToolDeadline(undefined, {}), TOOL_DEADLINE_MS);
});

test("a declared ceiling is derived from the call's own arguments", () => {
  // run_shell waits 60s by default and up to 600s on request; a fixed number
  // would have to be the larger of the two for every call.
  const quick = resolveToolDeadline(runShell, {});
  const slow = resolveToolDeadline(runShell, { timeout_s: 600 });
  assert.ok(slow > quick, `${slow} should exceed ${quick}`);
  assert.ok(quick > 60_000, "must sit above the tool's own timeout, never below it");
  assert.ok(slow > 600_000);
});

test("a background launch is not given the foreground's ceiling", () => {
  assert.ok(resolveToolDeadline(runShell, { background: true }) < 60_000);
});

test("a declaration that throws falls back instead of taking the turn down", () => {
  const handler = { deadlineMs: () => { throw new Error("nope"); } };
  assert.equal(resolveToolDeadline(handler, {}), TOOL_DEADLINE_MS);
  assert.equal(resolveToolDeadline({ deadlineMs: -5 }, {}), TOOL_DEADLINE_MS);
  assert.equal(resolveToolDeadline({ deadlineMs: "soon" }, {}), TOOL_DEADLINE_MS);
});

// ---------------------------------------------------------------------------
// 3. stop, mid-tool
// ---------------------------------------------------------------------------

test("an abort during a running tool is raised, not folded into a result", async () => {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(
    () => runToolWithWatchdog(() => new Promise(() => {}), {
      name: "t", deadlineMs: 60_000, signal: ctrl.signal,
    }),
    (e) => e.name === "AbortError"
  );
});

test("a signal already aborted does not start a tool call and wait for it", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () => runToolWithWatchdog(() => new Promise(() => {}), {
      name: "t", deadlineMs: 60_000, signal: ctrl.signal,
    }),
    (e) => e.name === "AbortError"
  );
});

test("run_shell stops waiting when the turn is aborted, whatever the child does", async () => {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const ctrl = new AbortController();
  const handler = runShell.makeHandler({
    projects: projectsStub(root),
    requirePermission: allow,
    abortSignal: ctrl.signal,
  });
  setTimeout(() => ctrl.abort(), 50);
  const started = Date.now();
  const out = await handler({ command: "sleep 30", timeout_s: 30 });
  assert.ok(Date.now() - started < 5000, "must not wait out the command's own timeout");
  assert.equal(out.aborted, true);
});
