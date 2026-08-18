// Bug 1 regression: a runtime binary that "succeeds" (exit 0) but never
// actually does the work — empty stdout, no transcript path — must surface as
// an error, not a success. Same goes for non-zero exits.
//
// We fake the runtime binary on PATH and drive call_runtime through its real
// handler so the failure detection runs end-to-end.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectManager } from "#host/daemon/db.js";
import { makeToolHandlers } from "#core/agent/tools/registry.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

function withFakeBinary(name, body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-call-runtime-bin-"));
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, body, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const oldPath = process.env.PATH || "";
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  return Promise.resolve(fn()).finally(() => {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

function setup() {
  const root = makeTempProject({
    name: "Test Project",
    agents: [{ slug: "roby", role: "Coordinator", model: "mock:test" }],
  });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  return { root, projects };
}

test("call_runtime flags a runtime that exits 0 with empty output as failed", async () => {
  const { root, projects } = setup();
  try {
    // Fake "aider" that succeeds silently — exit 0, no stdout, no stderr.
    await withFakeBinary("aider", "#!/bin/sh\nexit 0\n", async () => {
      const handlers = makeToolHandlers({
        projects,
        plugins: null,
        registries: null,
        globalConfig: { super_agent: { permission_mode: "total" } },
      });
      const r = await handlers.call_runtime({
        runtime: "aider",
        prompt: "do something useful",
      });
      assert.ok(r.error, "expected an error field on silent-success runtime");
      assert.match(r.error, /did not complete successfully/);
      assert.equal(r.runtime, "aider");
      assert.equal(r.exit_code, 0, "real exit code is still surfaced");
      assert.ok(r.apc_session, "the apc session id is still returned");
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("call_runtime carries the CLI's own refusal line and the duty to report it", async () => {
  const { root, projects } = setup();
  try {
    // A logged-out CLI: the exit code says nothing, the one line it printed
    // says everything. Both must reach the model.
    await withFakeBinary("aider", "#!/bin/sh\necho 'Not logged in · Please run /login' 1>&2\nexit 1\n", async () => {
      const handlers = makeToolHandlers({
        projects,
        plugins: null,
        registries: null,
        globalConfig: { super_agent: { permission_mode: "total" } },
      });
      const r = await handlers.call_runtime({
        runtime: "aider",
        prompt: "do something",
      });
      assert.match(r.error, /Not logged in/, "the CLI's refusal line rides along with the exit code");
      assert.ok(r.next_step, "a failed run tells the model what it owes the user");
      assert.match(r.next_step, /Not logged in/, "the instruction repeats the diagnosis");
      assert.match(r.next_step, /Do NOT silently retry/i);
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("call_runtime unwraps a JSON envelope instead of quoting it", async () => {
  const { root, projects } = setup();
  try {
    // `claude -p --output-format json` reports its refusal inside .result and
    // still exits non-zero. The sentence is the diagnosis, not the envelope.
    const body = "#!/bin/sh\necho '{\"is_error\":true,\"result\":\"Not logged in · Please run /login\",\"session_id\":\"x\"}'\nexit 1\n";
    await withFakeBinary("aider", body, async () => {
      const handlers = makeToolHandlers({
        projects,
        plugins: null,
        registries: null,
        globalConfig: { super_agent: { permission_mode: "total" } },
      });
      const r = await handlers.call_runtime({ runtime: "aider", prompt: "do something" });
      assert.match(r.error, /Not logged in · Please run \/login/);
      assert.doesNotMatch(r.error, /is_error/, "the JSON envelope stays out of the message");
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("call_runtime reports a timeout as a timeout, not as the signal's exit code", async () => {
  const { root, projects } = setup();
  try {
    // Answers --version at once (the availability probe must pass), then hangs
    // on the real run so our own SIGTERM is what ends it.
    const body = "#!/bin/sh\ncase \"$1\" in --version) echo 1.0; exit 0;; esac\nsleep 5\n";
    await withFakeBinary("aider", body, async () => {
      const handlers = makeToolHandlers({
        projects,
        plugins: null,
        registries: null,
        globalConfig: { super_agent: { permission_mode: "total" } },
      });
      const r = await handlers.call_runtime({ runtime: "aider", prompt: "take your time", timeout_s: 1 });
      assert.match(r.error, /timeout/i, "SIGTERM was ours; say so instead of blaming exit 143");
    });
  } finally {
    cleanupTempProject(root);
  }
});

test("call_runtime flags a runtime that exits non-zero as failed", async () => {
  const { root, projects } = setup();
  try {
    await withFakeBinary("aider", "#!/bin/sh\necho oops 1>&2\nexit 7\n", async () => {
      const handlers = makeToolHandlers({
        projects,
        plugins: null,
        registries: null,
        globalConfig: { super_agent: { permission_mode: "total" } },
      });
      const r = await handlers.call_runtime({
        runtime: "aider",
        prompt: "do something",
      });
      assert.ok(r.error, "expected an error field on non-zero exit");
      assert.match(r.error, /exit 7/);
      assert.equal(r.exit_code, 7);
      assert.match(r.stderr, /oops/);
    });
  } finally {
    cleanupTempProject(root);
  }
});
