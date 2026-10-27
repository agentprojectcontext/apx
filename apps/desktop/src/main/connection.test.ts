import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareLocalTarget, saveLocalTarget } from "../../../../packages/install/src/paths.ts";
import {
  applySavedLocalTarget,
  forgetConnection,
  initialConnection,
  loadConnection,
  localCoreLogFile,
  localCoreToken,
  localCoreUrl,
  normalizeUrl,
  saveConnection,
  validSshTarget,
  verifyLocalCore,
} from "./connection.ts";
import { sshArgs } from "./ssh-tunnel.ts";

test("web installation retains the exact home and port after a desktop restart without environment variables", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-desktop-target-"));
  const home = path.join(root, "core");
  const data = path.join(root, "desktop");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "home-id"), "same-home");
  fs.writeFileSync(path.join(home, "core.env"), "APX_HOST=127.0.0.1\n");
  try {
    saveLocalTarget(data, prepareLocalTarget({ home, port: 7551, home_id: "same-home" }, "stored-token"));
    const env: NodeJS.ProcessEnv = {};
    applySavedLocalTarget(data, env);
    assert.equal(env.APX_HOME, fs.realpathSync(home));
    assert.equal(localCoreUrl(env), "http://127.0.0.1:7551");
    assert.equal(localCoreToken(env), "stored-token");
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(home, "core.env")).mode & 0o077, 0);
    assert.match(fs.readFileSync(path.join(home, "core.env"), "utf8"), /APX_HOST=127.0.0.1/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, "connection.json"), "utf8")).token, undefined);
    assert.equal(initialConnection(data, env)?.mode, "local");
    fs.writeFileSync(path.join(home, "home-id"), "different-home");
    const previousConfig = fs.readFileSync(path.join(home, "core.env"), "utf8");
    assert.throws(
      () => prepareLocalTarget({ home, port: 7551, home_id: "same-home" }, "replacement-token"),
      /identity changed/,
    );
    assert.equal(fs.readFileSync(path.join(home, "core.env"), "utf8"), previousConfig);
    assert.throws(() => applySavedLocalTarget(data, {}), /another installation/);
    assert.throws(() => saveLocalTarget(data, { home, port: 7551, home_id: "same-home" }), /identity changed/);
    saveConnection(data, { mode: "url", url: "https://remote.example" });
    const clientEnv: NodeJS.ProcessEnv = {};
    applySavedLocalTarget(data, clientEnv);
    assert.equal(clientEnv.APX_HOME, undefined);
    assert.equal(initialConnection(data, clientEnv)?.mode, "url");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a chosen connection is kept, read back and forgotten; a broken file means none", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-conn-"));
  assert.equal(loadConnection(dir), undefined);
  saveConnection(dir, { mode: "ssh", target: "user@example.com" });
  assert.deepEqual(loadConnection(dir), { mode: "ssh", target: "user@example.com" });
  fs.writeFileSync(path.join(dir, "connection.json"), JSON.stringify({ mode: "url", url: 42 }));
  assert.equal(loadConnection(dir), undefined);
  forgetConnection(dir);
  assert.equal(loadConnection(dir), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an address the owner types becomes an origin; https is assumed and other schemes are refused", () => {
  assert.equal(normalizeUrl("box.example.ts.net"), "https://box.example.ts.net");
  assert.equal(normalizeUrl(" http://192.168.1.20:7440/some/path "), "http://192.168.1.20:7440");
  assert.equal(normalizeUrl("file:///etc/passwd"), undefined);
  assert.equal(normalizeUrl("not a url"), undefined);
});

test("an SSH target is user@host[:port] and never something ssh would read as an option", () => {
  assert.ok(validSshTarget("user@server.example.com"));
  assert.ok(validSshTarget("server:2222"));
  assert.ok(!validSshTarget("-oProxyCommand=evil"));
  assert.ok(!validSshTarget("user@host; rm -rf ~"));
});

test("the tunnel forwards the core's own port, passes the ssh port apart and ends options before the host", () => {
  const args = sshArgs("user@server:2222", 7440);
  assert.deepEqual(args.slice(-4), ["-L", "127.0.0.1:7440:127.0.0.1:7440", "--", "user@server"]);
  assert.ok(args.includes("BatchMode=yes"));
  assert.equal(args[args.indexOf("-p") + 1], "2222");
  assert.ok(!sshArgs("server", 7440).includes("-p"));
});

test("the local core's token comes from core.env in its home, when there is one", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-home-"));
  assert.equal(localCoreToken({ APX_HOME: home }), undefined);
  fs.writeFileSync(path.join(home, "core.env"), "APX_HOST=0.0.0.0\nAPX_TOKEN=abc123\n");
  assert.equal(localCoreToken({ APX_HOME: home }), "abc123");
  fs.rmSync(home, { recursive: true, force: true });
});

test("the embedded core logs into its home's logs folder, where the service and pnpm dev log too", () => {
  assert.equal(localCoreLogFile({ APX_HOME: "/tmp/acme" }), path.join("/tmp/acme", "logs", "core.log"));
  assert.equal(localCoreLogFile({}), path.join(os.homedir(), ".apx", "v2", "logs", "core.log"));
});

test("an explicit URL is connect-only, even when a local connection was saved", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-conn-target-"));
  try {
    saveConnection(dir, { mode: "local" });
    assert.deepEqual(initialConnection(dir, { APX_URL: "https://core.example.com", APX_CONNECTION: "local" }), {
      mode: "url",
      url: "https://core.example.com",
    });
    assert.deepEqual(initialConnection(dir, { APX_URL: "http://127.0.0.1:7550" }), {
      mode: "url",
      url: "http://127.0.0.1:7550",
    });
    assert.throws(() => initialConnection(dir, { APX_URL: "file:///tmp/core" }), /Invalid APX_URL/);
    fs.writeFileSync(path.join(dir, "core.env"), "APX_PORT=7550\nAPX_TOKEN=stored\n");
    assert.equal(localCoreUrl({ APX_HOME: dir, APX_URL: "https://core.example.com" }), "http://127.0.0.1:7550");
    assert.equal(localCoreUrl({ APX_HOME: dir, APX_PORT: "7660" }), "http://127.0.0.1:7660");
    assert.equal(localCoreToken({ APX_HOME: dir, APX_TOKEN: "explicit" }), "explicit");
    assert.throws(() => localCoreUrl({ APX_PORT: "0" }), /Invalid local APX_PORT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("local connection verifies the daemon home identity before lending capabilities", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-conn-home-"));
  let remoteIdentity = "selected-home";
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result: { home_id: remoteIdentity } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    fs.writeFileSync(path.join(dir, "home-id"), "selected-home\n");
    assert.equal(await verifyLocalCore(url, { APX_HOME: dir }), "matches");
    fs.writeFileSync(path.join(dir, "home-id"), "other-home\n");
    assert.equal(await verifyLocalCore(url, { APX_HOME: dir }), "mismatch");
    fs.writeFileSync(path.join(dir, "home-id"), " \n");
    assert.equal(await verifyLocalCore(url, { APX_HOME: dir }), "missing");
    fs.writeFileSync(path.join(dir, "home-id"), "selected-home\n");
    remoteIdentity = "";
    assert.equal(await verifyLocalCore(url, { APX_HOME: dir }), "missing");
    remoteIdentity = "selected-home";
    assert.equal(await verifyLocalCore(url, { APX_HOME: dir }), "matches");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
