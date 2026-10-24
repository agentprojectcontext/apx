import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { harnessOf, isCliRef } from "../domain/refs.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";
import { isWindowsShim, type OneshotId, oneshotHarness, oneshotStatus } from "./oneshot.ts";
import type { TurnIO } from "./types.ts";

const root = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-oneshot-test-")));
after(() => removeDir(root));
const fixture = fileURLToPath(new URL("./fake-oneshot.test-support.mjs", import.meta.url));

test("discovery does not confuse a GUI installation with headless availability or claim authentication", async () => {
  const missing = await oneshotStatus("antigravity", async (name) =>
    name === "antigravity-ide" ? "/tmp/antigravity-ide" : undefined,
  );
  assert.equal(missing.installed, false);
  assert.equal(missing.logged_in, false);
  for (const id of ["aider", "antigravity"] as const) {
    const found = await oneshotStatus(id, async () => process.execPath);
    assert.equal(found.installed, true);
    assert.equal(found.logged_in, false);
    assert.equal(found.auth, "on_invocation");
    assert.equal(found.detail_code, "oneshot");
  }
});
test("Windows command shims are unavailable instead of failing at spawn", async () => {
  for (const suffix of [".cmd", ".BAT"]) {
    const binary = `C:\\cli\\agy${suffix}`;
    assert.equal(isWindowsShim(binary, "win32"), true);
    const status = await oneshotStatus("antigravity", async () => binary, "win32");
    assert.equal(status.installed, false);
    assert.equal(status.detail_code, "oneshot_windows_shim");
  }
  assert.equal(isWindowsShim("C:\\cli\\agy.exe", "win32"), false);
  assert.equal(isWindowsShim("/opt/agy.cmd", "linux"), false);
});

function setup(id: OneshotId, mode = "echo", approved = true) {
  const events: string[] = [];
  const harness = oneshotHarness(id, {
    cwd: () => root,
    binary: async () => process.execPath,
    prefixArgs: [fixture, mode],
  });
  const io = {
    run: { id: "run-test" },
    system: "System rules",
    history: [
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Answer" },
    ],
    models: [`${id}/acme-model`],
    input: { role: "user", content: "Untrusted $(touch never); --flag" },
    signal: AbortSignal.timeout(5_000),
    approve: async () => {
      events.push("approve");
      return approved;
    },
    observe: (e: { status: string }) => events.push(e.status),
    onText() {},
  } as unknown as TurnIO;
  return { harness, io, events };
}

for (const id of ["aider", "antigravity"] as const) {
  test(`${id} rejects model option injection before approval or spawn`, async () => {
    const { harness, io, events } = setup(id);
    io.models = [`${id}/--dangerously-skip-permissions`];
    await assert.rejects(harness.run(io), /model must not start/);
    assert.deepEqual(events, []);
  });
  test(`${id} routes as a CLI and invokes a real child without a shell, with prompt and text history`, async () => {
    assert.equal(harnessOf(`${id}/acme-model`), id);
    assert.equal(isCliRef(id), true);
    const { harness, io, events } = setup(id);
    process.env.APX_ONESHOT_TEST_SECRET = "must not reach child";
    process.env.ONESHOT_TEST_CREDENTIAL = "must not reach child";
    try {
      const result = await harness.run(io);
      const body = JSON.parse(result.text);
      assert.equal(body.cwd, root);
      assert.equal(body.apx, undefined);
      assert.equal(body.credential, undefined);
      assert.ok(!JSON.stringify(body.args).includes("System rules"));
      assert.ok(body.prompt.includes("System rules"));
      assert.ok(body.prompt.includes("[assistant]\nAnswer"));
      assert.ok(body.prompt.includes(io.input.content));
      assert.deepEqual(body.args.slice(0, 2), ["--model", "acme-model"]);
      assert.equal(result.sessionId, undefined);
      assert.deepEqual(events, ["approve", "running", "ok"]);
      if (id === "aider") {
        // POSIX modes only: Windows reports fixed bits that say nothing about who may read the file.
        if (process.platform !== "win32") assert.equal(body.mode, 0o600);
        assert.ok(body.args.includes("--no-auto-commits"));
        assert.ok(!body.args.includes(io.input.content));
        assert.equal(fs.existsSync(body.args[body.args.indexOf("--message-file") + 1]), false);
      }
    } finally {
      delete process.env.APX_ONESHOT_TEST_SECRET;
      delete process.env.ONESHOT_TEST_CREDENTIAL;
    }
  });
  test(`${id} refuses denied execution before spawning`, async () => {
    const { harness, io, events } = setup(id, "echo", false);
    await assert.rejects(harness.run(io), /not approved/);
    assert.deepEqual(events, ["approve"]);
  });
}
for (const [mode, error] of [
  ["fail", /exited with 7/],
  ["large", /exceeded/],
  ["binary", /binary/],
  ["empty", /no text/],
] as const) {
  test(`CLI ${mode} fails without leaking stderr and marks the step terminal`, async () => {
    const { harness, io, events } = setup("aider", mode);
    await assert.rejects(
      harness.run(io),
      (err: Error) => error.test(err.message) && !err.message.includes("secret credential"),
    );
    assert.deepEqual(events, ["approve", "running", "error"]);
  });
}
test("a canceled invocation kills the child and ends the step", async () => {
  const { harness, io, events } = setup("aider", "hang");
  const controller = new AbortController();
  io.signal = AbortSignal.any([io.signal, controller.signal]);
  let started = false;
  io.alive = () => {
    started = true;
    controller.abort();
  };
  await assert.rejects(harness.run(io), /canceled/);
  assert.equal(started, true);
  assert.deepEqual(events, ["approve", "running", "error"]);
});
test("pre-aborted turns and unsupported images or effort never request execution", async () => {
  for (const mode of ["abort", "images", "effort"]) {
    const { harness, io, events } = setup("aider");
    if (mode === "abort") io.signal = AbortSignal.abort();
    if (mode === "images") io.input.images = [{ media_id: "image-test", mime: "image/png" }];
    if (mode === "effort") io.models = ["aider#high"];
    await assert.rejects(harness.run(io));
    assert.deepEqual(events, []);
  }
});
