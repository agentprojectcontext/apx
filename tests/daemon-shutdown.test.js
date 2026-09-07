// Who is allowed to end the process.
//
// THE FAILURE THIS FIXES, from a real install (2026-09-07): the daemon's
// shutdown never ran. `kill -TERM` on an idle daemon left no "received SIGTERM"
// line in any log, left ~/.apx/daemon.pid naming a dead process — so every
// later `apx restart` signalled a ghost and gave up with "did not shut down in
// time" — and lost any turn in flight with nothing written to the ledger.
//
// The cause was not the daemon's handler. `core/artifacts/tunnel.js` exports a
// module-level singleton, so merely IMPORTING it installs process-wide signal
// handlers, and those handlers called `process.exit(143)`. Signal listeners run
// in registration order; that file is imported while routes are wired, before
// the daemon registers its own `shutdown`. So the tunnel cleaned up, exited,
// and everything after it never happened.
//
// A library cleans up after itself. Whoever owns the process decides when it
// ends. These tests hold that line.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-shutdown-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const { TunnelManager } = await import("#core/artifacts/tunnel.js");

/** Construct a manager and hand back the SIGTERM listener it just installed. */
function listenerFrom(signal, build) {
  const before = new Set(process.listeners(signal));
  const made = build();
  const added = process.listeners(signal).filter((l) => !before.has(l));
  const detach = () => added.forEach((l) => process.removeListener(signal, l));
  return { listener: added[0], added, detach, made };
}

test("the tunnel cleans up on SIGTERM without ending the process", () => {
  const owner = () => {};
  process.on("SIGTERM", owner); // stand-in for the daemon's own shutdown
  const { listener, detach } = listenerFrom("SIGTERM", () => new TunnelManager());
  const realExit = process.exit;
  const realKill = process.kill;
  const calls = [];
  process.exit = (c) => calls.push(["exit", c]);
  process.kill = (p, s) => calls.push(["kill", s]);
  try {
    assert.ok(listener, "the manager installed no SIGTERM listener");
    listener("SIGTERM");
    assert.deepEqual(calls, [], "a library must not decide the process's fate");
  } finally {
    process.exit = realExit;
    process.kill = realKill;
    detach();
    process.removeListener("SIGTERM", owner);
  }
});

test("with no owner listening it re-raises, so a lone process still dies", () => {
  // Registering a listener suppresses the default termination. If nothing else
  // is listening there is no owner to exit, and without the re-raise the
  // process would hang on a signal that should have killed it.
  const before = process.listeners("SIGTERM");
  before.forEach((l) => process.removeListener("SIGTERM", l));
  const { listener, detach } = listenerFrom("SIGTERM", () => new TunnelManager());
  const realExit = process.exit;
  const realKill = process.kill;
  const calls = [];
  process.exit = (c) => calls.push(["exit", c]);
  process.kill = (p, s) => calls.push(["kill", s]);
  try {
    listener("SIGTERM");
    assert.deepEqual(calls, [["kill", "SIGTERM"]], "expected the signal re-raised, not an exit code chosen for us");
  } finally {
    process.exit = realExit;
    process.kill = realKill;
    detach();
    before.forEach((l) => process.on("SIGTERM", l));
  }
});

// Static guard for the whole class of bug. Anything under src/core or
// src/host that registers a signal handler and exits from it takes the
// decision away from every process that imports it — and the import can be
// three levels away from anyone who knows about it.
const OWNERS_OF_THE_PROCESS = [
  "host/daemon/index.js", // the daemon entrypoint IS the owner
];

function* sourceFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* sourceFiles(full);
    else if (e.name.endsWith(".js")) yield full;
  }
}

test("no library under core/ or host/ exits the process from a signal handler", () => {
  const offenders = [];
  for (const dir of ["core", "host"]) {
    for (const file of sourceFiles(path.join(SRC, dir))) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (OWNERS_OF_THE_PROCESS.includes(rel)) continue;
      const body = fs.readFileSync(file, "utf8");
      for (const m of body.matchAll(/process\.(on|once)\(\s*["']SIG[A-Z0-9]+["']/g)) {
        // The handler is whatever follows, up to a blank line — enough to catch
        // the one-liners this rule exists for without parsing JavaScript.
        const after = body.slice(m.index, m.index + 300);
        if (/process\.exit\s*\(/.test(after.split("\n\n")[0])) {
          offenders.push(`${rel}: ${after.split("\n")[0].trim()}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], "a signal handler here ends a process it does not own");
});
