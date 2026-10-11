import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installArgs, sshArgs, sshCommand, useIdentity } from "./ssh-tunnel.ts";

test("a command over ssh never asks for a password and takes the port from the target", () => {
  assert.deepEqual(sshCommand("ops@box:2222", "uname -s").slice(-4), ["2222", "--", "ops@box", "uname -s"]);
  assert.ok(sshCommand("ops@box", "true").includes("BatchMode=yes"));
  assert.ok(!sshCommand("ops@box", "true").includes("-p"));
});

test("the tunnel forwards the core's port to the same port here", () => {
  assert.deepEqual(sshArgs("ops@box", 7440).slice(-4), ["-L", "127.0.0.1:7440:127.0.0.1:7440", "--", "ops@box"]);
});

test("the server gets this app's version when it is a release, and the app's feed when it has one", () => {
  assert.deepEqual(installArgs("2.3.0", undefined), ["--version", "2.3.0"]);
  assert.deepEqual(installArgs("2.3.0-dev.4+abc", undefined), []);
  assert.deepEqual(installArgs("2.3.0", "http://192.168.0.10:7480"), [
    "--version",
    "2.3.0",
    "--feed",
    "http://192.168.0.10:7480",
  ]);
  // Anything a shell would read as more than one word stays out of the remote command line.
  assert.deepEqual(installArgs("2.3.0", "acme/apx; rm -rf ~"), ["--version", "2.3.0"]);
});

test("once this app has its own key, every ssh offers it too (and never before the file exists)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-key-"));
  const key = path.join(dir, "apx_ed25519");
  try {
    useIdentity(key);
    assert.ok(!sshCommand("ops@box", "true").includes("-i"));
    fs.writeFileSync(key, "");
    const command = sshCommand("ops@box:2222", "true");
    assert.deepEqual(command.slice(command.indexOf("-i"), command.indexOf("-i") + 2), ["-i", key]);
    // The owner's own keys and agent still count: nothing limits ssh to this one.
    assert.ok(!command.join(" ").includes("IdentitiesOnly"));
    const tunnel = sshArgs("ops@box", 7440);
    assert.ok(tunnel.indexOf("-i") >= 0 && tunnel.indexOf("-i") < tunnel.indexOf("--"));
  } finally {
    useIdentity(undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
