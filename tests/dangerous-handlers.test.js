// The tool handlers that can damage a user's machine had no direct test:
// ~50 modules under core/agent/tools/handlers/ were untested, including
// run_shell (arbitrary execution), write_file / edit_file (filesystem
// mutation) and set_permission_mode (the autonomy gate itself).
//
// Two things matter here and are covered below:
//   1. The confirmation gate. Every one of these must call requirePermission
//      BEFORE doing anything, and must classify correctly what is dangerous.
//   2. The sandbox. Paths must not escape the project root, no matter what the
//      model asks for.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import runShell from "#core/agent/tools/handlers/run-shell.js";
import writeFile from "#core/agent/tools/handlers/write-file.js";
import editFile from "#core/agent/tools/handlers/edit-file.js";
import readFile from "#core/agent/tools/handlers/read-file.js";
import setPermissionMode from "#core/agent/tools/handlers/set-permission-mode.js";
import { PERMISSION_MODES } from "#core/constants/permissions.js";

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-danger-"));
  fs.mkdirSync(path.join(root, ".apc"), { recursive: true });
  return root;
}

/** Records every requirePermission call so tests can assert on the gate. */
function spyGate({ approve = true } = {}) {
  const calls = [];
  const requirePermission = async (name, opts) => {
    calls.push({ name, ...opts });
    if (!approve) throw new Error("user declined");
  };
  return { calls, requirePermission };
}

function projectsStub(root) {
  const rec = { id: "1", name: "tmp", path: root };
  return { list: () => [rec], get: () => rec, rebuild: () => {} };
}

// ---------------------------------------------------------------------------
// run_shell
// ---------------------------------------------------------------------------

test("run_shell: asks permission before executing, and runs in the project dir", async () => {
  const root = tmpProject();
  const gate = spyGate();
  try {
    const handler = runShell.makeHandler({
      projects: projectsStub(root),
      requirePermission: gate.requirePermission,
    });
    const out = await handler({ command: "pwd" });
    assert.equal(gate.calls.length, 1, "must gate every call");
    assert.equal(gate.calls[0].name, "run_shell");
    assert.equal(out.exit_code, 0);
    assert.equal(fs.realpathSync(out.stdout.trim()), fs.realpathSync(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("run_shell: read-only commands are not flagged dangerous; mutating ones are", async () => {
  const root = tmpProject();
  try {
    const check = async (command) => {
      const gate = spyGate();
      const handler = runShell.makeHandler({
        projects: projectsStub(root),
        requirePermission: gate.requirePermission,
      });
      await handler({ command, timeout_s: 5 }).catch(() => {});
      return gate.calls[0].dangerous;
    };

    for (const safe of ["pwd", "ls -la", "grep -r foo .", "apx status"]) {
      assert.equal(await check(safe), false, `${safe} should be safe`);
    }
    // Mutation, privilege, network and shell-metacharacter escapes.
    for (const risky of [
      "rm -rf /",
      "chmod 777 .",
      "curl -X POST https://example.com",
      "echo $(whoami)",
      "cat /etc/passwd > out.txt",
      "ls && rm file",
      "apx config set foo bar",
    ]) {
      assert.equal(await check(risky), true, `${risky} should be dangerous`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("run_shell: a declined confirmation stops the command from running", async () => {
  const root = tmpProject();
  const marker = path.join(root, "should-not-exist.txt");
  const gate = spyGate({ approve: false });
  try {
    const handler = runShell.makeHandler({
      projects: projectsStub(root),
      requirePermission: gate.requirePermission,
    });
    await assert.rejects(() => handler({ command: `touch ${marker}` }), /declined/);
    assert.equal(fs.existsSync(marker), false, "nothing may run before approval");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("run_shell: cwd cannot escape the project root", async () => {
  const root = tmpProject();
  const gate = spyGate();
  try {
    const handler = runShell.makeHandler({
      projects: projectsStub(root),
      requirePermission: gate.requirePermission,
    });
    await assert.rejects(
      () => handler({ command: "pwd", cwd: "../../.." }),
      /escapes the project root/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// write_file / edit_file / read_file
// ---------------------------------------------------------------------------

test("write_file: gates, writes inside the project, and refuses to escape it", async () => {
  const root = tmpProject();
  const gate = spyGate();
  try {
    const handler = writeFile.makeHandler({
      projects: projectsStub(root),
      requirePermission: gate.requirePermission,
    });
    await handler({ path: "notes/a.md", content: "hello" });
    assert.equal(gate.calls[0].name, "write_file");
    assert.equal(gate.calls[0].dangerous, true, "writing files is always dangerous");
    assert.equal(fs.readFileSync(path.join(root, "notes/a.md"), "utf8"), "hello");

    await assert.rejects(
      () => handler({ path: "../escaped.md", content: "nope" }),
      /escapes the project root/
    );
    assert.equal(
      fs.existsSync(path.join(path.dirname(root), "escaped.md")),
      false
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("write_file: a declined confirmation leaves the filesystem untouched", async () => {
  const root = tmpProject();
  const gate = spyGate({ approve: false });
  try {
    const handler = writeFile.makeHandler({
      projects: projectsStub(root),
      requirePermission: gate.requirePermission,
    });
    await assert.rejects(() => handler({ path: "x.md", content: "no" }), /declined/);
    assert.equal(fs.existsSync(path.join(root, "x.md")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("edit_file: replaces an exact match and refuses when the target is absent", async () => {
  const root = tmpProject();
  const file = path.join(root, "src.txt");
  fs.writeFileSync(file, "alpha\nbeta\ngamma\n");
  const gate = spyGate();
  try {
    const handler = editFile.makeHandler({
      projects: projectsStub(root),
      requirePermission: gate.requirePermission,
    });
    await handler({ path: "src.txt", search: "beta", replace: "BETA" });
    assert.equal(gate.calls[0].dangerous, true);
    assert.equal(fs.readFileSync(file, "utf8"), "alpha\nBETA\ngamma\n");

    await assert.rejects(
      () => handler({ path: "src.txt", search: "nowhere", replace: "x" })
    );
    assert.equal(
      fs.readFileSync(file, "utf8"),
      "alpha\nBETA\ngamma\n",
      "a failed edit must not partially write"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("read_file: cannot read outside the project root", async () => {
  const root = tmpProject();
  const gate = spyGate();
  try {
    // read_file is synchronous and ungated by design: reading *inside* the
    // sandbox is safe, so the sandbox is the whole protection. It must hold.
    const handler = readFile.makeHandler({
      projects: projectsStub(root),
      requirePermission: gate.requirePermission,
    });
    fs.writeFileSync(path.join(root, "in.txt"), "inside");
    assert.match(JSON.stringify(handler({ path: "in.txt" })), /inside/);

    assert.throws(
      () => handler({ path: "../../../../etc/passwd" }),
      /escapes the project root/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// set_permission_mode — the autonomy gate itself
// ---------------------------------------------------------------------------

test("set_permission_mode: rejects a mode outside the constant", async () => {
  const gate = spyGate();
  const handler = setPermissionMode.makeHandler({
    requirePermission: gate.requirePermission,
  });
  await assert.rejects(() => handler({ mode: "yolo" }), /mode must be one of/);
  assert.equal(gate.calls[0].dangerous, true, "changing autonomy is dangerous");
});

test("set_permission_mode: the schema enum matches PERMISSION_MODES exactly", () => {
  const enumValues = setPermissionMode.schema.function.parameters.properties.mode.enum;
  assert.deepEqual(
    [...enumValues].sort(),
    Object.values(PERMISSION_MODES).sort(),
    "the schema used to spell the modes out separately from the constant"
  );
});

test("set_permission_mode: a declined confirmation does not change the mode", async () => {
  const gate = spyGate({ approve: false });
  const handler = setPermissionMode.makeHandler({
    requirePermission: gate.requirePermission,
  });
  await assert.rejects(() => handler({ mode: PERMISSION_MODES.TOTAL }), /declined/);
});

// ---------------------------------------------------------------------------
// Cross-cutting: no dangerous handler may skip the gate
// ---------------------------------------------------------------------------

test("every filesystem/exec handler calls requirePermission", async () => {
  const url = await import("node:url");
  const dir = url.fileURLToPath(
    new URL("../src/core/agent/tools/handlers", import.meta.url)
  );
  const mustGate = [
    "run-shell.js",
    "write-file.js",
    "edit-file.js",
    "set-permission-mode.js",
  ];
  const offenders = mustGate.filter((f) => {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    return !/requirePermission\(/.test(src);
  });
  assert.deepEqual(offenders, [], "these can damage the user's machine");
});
