// The CLI's http client when the daemon does not answer and this process may not
// fix that: a sandboxed coding CLI that blocks loopback and writes outside its
// workspace. The failure has to say so, not surface a raw EPERM from opening the
// daemon log — and it must never spawn a second daemon next to a live one.
import { test, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodeHttp from "node:http";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-unreachable-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

// A stand-in daemon whose health check fails until a test says otherwise, so
// ping() is false without depending on what else listens on the machine.
let healthy = false;
const server = nodeHttp.createServer((req, res) => {
  if (req.url.split("?")[0] === "/api/health" && healthy) return res.end(JSON.stringify({ status: "ok" }));
  res.statusCode = 503;
  res.end(JSON.stringify({ error: "unavailable" }));
});
// Top level: http.js reads the port at module load.
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.APX_PORT = String(server.address().port);
process.env.APX_HOST = "127.0.0.1";
after(() => server.close());

const { ensureDaemon, http } = await import("../src/interfaces/cli/http.js");
const { LOG_PATH, PID_PATH } = await import("../src/core/config/paths.js");

// Opening the daemon log is the step a sandbox forbids. Every test stubs it, so
// no path in this file can ever reach spawn() and start a real daemon.
const realOpenSync = fs.openSync;
function forbidLog(code = "EPERM") {
  const calls = [];
  mock.method(fs, "openSync", (p, ...rest) => {
    if (p === LOG_PATH) {
      calls.push(p);
      const e = new Error(`${code}: operation not permitted, open '${p}'`);
      e.code = code;
      throw e;
    }
    return realOpenSync(p, ...rest);
  });
  return calls;
}

afterEach(() => {
  mock.restoreAll();
  healthy = false;
  fs.rmSync(PID_PATH, { force: true });
});

test("an unwritable APX home ends in a clear message, not a raw EPERM", async () => {
  forbidLog("EPERM");
  const e = await http.get("/api/messages").then(() => null, (err) => err);
  assert.ok(e, "expected the request to fail");
  assert.doesNotMatch(e.message, /^EPERM/);
  assert.equal(e.code, "APX_DAEMON_UNREACHABLE");
  assert.match(e.message, /did not answer/);
  assert.ok(e.message.includes(`127.0.0.1:${process.env.APX_PORT}`), "names where it looked");
  assert.ok(e.message.includes(process.env.APX_HOME), "names the home it could not write");
  assert.match(e.message, /not writable here \(EPERM\)/);
  assert.match(e.message, /sandbox/);
  assert.match(e.message, /outside the sandbox/);
});

test("a read-only filesystem is reported the same way", async () => {
  forbidLog("EROFS");
  const e = await ensureDaemon({ silent: true }).then(() => null, (err) => err);
  assert.equal(e?.code, "APX_DAEMON_UNREACHABLE");
  assert.match(e.message, /not writable here \(EROFS\)/);
});

test("a connection the sandbox forbids is reported without trying to start a daemon", async () => {
  const opened = forbidLog();
  mock.method(globalThis, "fetch", async () => {
    const cause = Object.assign(new Error("connect EPERM"), { code: "EPERM" });
    throw Object.assign(new TypeError("fetch failed"), { cause });
  });
  const e = await ensureDaemon({ silent: true }).then(() => null, (err) => err);
  assert.equal(e?.code, "APX_DAEMON_UNREACHABLE");
  assert.match(e.message, /not allowed to connect to it \(EPERM\)/);
  assert.deepEqual(opened, [], "starting a second daemon cannot fix a forbidden connection");
});

test("a live daemon pid is reported as running but unreachable, not started again", async () => {
  const opened = forbidLog();
  fs.writeFileSync(PID_PATH, String(process.ppid));
  const e = await ensureDaemon({ silent: true, bootWaitMs: 300 }).then(() => null, (err) => err);
  assert.equal(e?.code, "APX_DAEMON_UNREACHABLE");
  assert.match(e.message, new RegExp(`seems to be running \\(pid ${process.ppid}\\)`));
  assert.match(e.message, /cannot reach it/);
  assert.deepEqual(opened, [], "no second daemon next to a live one");
});

test("a live daemon that is still booting is waited for", async () => {
  const opened = forbidLog();
  fs.writeFileSync(PID_PATH, String(process.ppid));
  setTimeout(() => { healthy = true; }, 300);
  await ensureDaemon({ silent: true, bootWaitMs: 5000 });
  assert.deepEqual(opened, []);
});

test("a stale pid file does not stop the usual start attempt", async () => {
  const opened = forbidLog();
  fs.writeFileSync(PID_PATH, "999999999");
  const e = await ensureDaemon({ silent: true }).then(() => null, (err) => err);
  assert.match(e?.message || "", /not writable here/);
  assert.equal(opened.length, 1, "with no live daemon, it still tries to start one");
});
