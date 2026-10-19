import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installArgs, sshArgs, sshCommand, startTunnel, useIdentity } from "./ssh-tunnel.ts";

test("a command over ssh never asks for a password and takes the port from the target", () => {
  assert.deepEqual(sshCommand("ops@box:2222", "uname -s").slice(-4), ["2222", "--", "ops@box", "uname -s"]);
  assert.ok(sshCommand("ops@box", "true").includes("BatchMode=yes"));
  assert.ok(!sshCommand("ops@box", "true").includes("-p"));
});

test("the tunnel forwards the core's port to the same port here", () => {
  assert.deepEqual(sshArgs("ops@box", 7440).slice(-4), ["-L", "127.0.0.1:7440:127.0.0.1:7440", "--", "ops@box"]);
});

test("a failed SSH bind cannot declare an unrelated local listener ready", async () => {
  const server = createServer((socket) => socket.end("unrelated local service"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const tunnel = startTunnel(
    "ops@box",
    address.port,
    () => {},
    undefined,
    () =>
      spawn(
        process.execPath,
        [
          "-e",
          `const net = require('node:net'); const server = net.createServer(); server.on('error', () => process.exit(255)); server.listen(${address.port}, '127.0.0.1');`,
        ],
        { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
      ),
  );
  try {
    await assert.rejects(tunnel.ready, /could not bind local port/);
    assert.equal(tunnel.alive(), false);
    assert.equal(server.listening, true);
  } finally {
    tunnel.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("only a confirmed SSH listener becomes ready, and stopping cancels reconnect backoff", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let launches = 0;
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.stderr.write('debug1: Local forwarding listening on 127.0.0.1 port 7440.\\n'); setTimeout(() => process.exit(0), 20);",
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );
  const exited = once(child, "exit");
  const tunnel = startTunnel(
    "ops@box",
    7440,
    () => {},
    undefined,
    () => {
      launches++;
      return child;
    },
  );
  try {
    await tunnel.ready;
    assert.equal(tunnel.alive(), true);
    await exited;
    assert.equal(tunnel.alive(), false);
    tunnel.stop();
    t.mock.timers.tick(60_000);
    assert.equal(launches, 1);
  } finally {
    tunnel.stop();
  }
});

test("the server gets this app's version when it is a release, and the app's feed when it has one", () => {
  assert.deepEqual(installArgs("2.3.0", undefined), ["--server", "--version", "2.3.0"]);
  assert.deepEqual(installArgs("2.3.0-dev.4+abc", undefined), ["--server"]);
  assert.deepEqual(installArgs("2.3.0", "http://192.168.0.10:7480"), [
    "--server",
    "--version",
    "2.3.0",
    "--feed",
    "http://192.168.0.10:7480",
  ]);
  // Anything a shell would read as more than one word stays out of the remote command line.
  assert.deepEqual(installArgs("2.3.0", "acme/apx; rm -rf ~"), ["--server", "--version", "2.3.0"]);
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
