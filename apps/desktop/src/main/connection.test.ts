import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  forgetConnection,
  loadConnection,
  localCoreLogFile,
  localCoreToken,
  normalizeUrl,
  saveConnection,
  validSshTarget,
} from "./connection.ts";
import { sshArgs } from "./ssh-tunnel.ts";

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
