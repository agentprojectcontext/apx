// `run_shell` must not let an agent restart the daemon it is running inside.
// Seen in production: an agent edited a tool handler, ran `apx restart` "to load
// the new code", and executed itself two steps from finishing — the process
// died, the stream to the user was cut, and the whole turn was lost with no
// report of what it had already done.
import { test } from "node:test";
import assert from "node:assert/strict";
import runShell, { killsOwnDaemon } from "#core/agent/tools/handlers/run-shell.js";

test("killsOwnDaemon: catches the self-kill forms, including chained ones", () => {
  for (const cmd of [
    "apx restart",
    "cd /some/repo && apx restart",
    "apx daemon restart",
    "apx daemon stop",
    "sleep 1; apx daemon kill",
    "pkill -f apx-daemon",
    "killall apx-daemon",
  ]) {
    assert.equal(killsOwnDaemon(cmd), true, `should be refused: ${cmd}`);
  }
});

test("killsOwnDaemon: leaves everything else alone", () => {
  for (const cmd of [
    "apx status",
    "apx routine list",
    "apx desktop restart",   // a different process; the daemon survives it
    "git restart",           // not a thing, but not ours to refuse either
    "npm test",
    "echo apx restart is what the user should run",
  ]) {
    assert.equal(killsOwnDaemon(cmd), false, `should be allowed: ${cmd}`);
  }
});

test("run_shell refuses a self-kill with an explanation instead of running it", async () => {
  let ran = false;
  const ctx = {
    projects: { list: () => [{ id: 0, name: "default", path: process.cwd() }], get: () => ({ id: 0, name: "default", path: process.cwd() }) },
    requirePermission: async () => { ran = true; },
  };
  const out = await runShell.makeHandler(ctx)({ command: "apx restart" });
  assert.match(out.error, /refused/);
  assert.match(out.error, /running inside/);
  // It must not be a confirmation prompt — no answer makes this succeed.
  assert.equal(out.exit_code, undefined, "the command must never reach the shell");
  assert.equal(ran, true, "the permission gate still runs first");
});
