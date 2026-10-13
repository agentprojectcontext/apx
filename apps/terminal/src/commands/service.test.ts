import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { lastLines, logs, stopCore, windowsStopScript } from "./service.ts";
import { printed } from "./testing.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-logs-"));
after(() => fs.rmSync(home, { recursive: true, force: true }));

test("lastLines reads the end of a log, across read blocks, without a trailing empty line", () => {
  const file = path.join(home, "big.log");
  const all = Array.from({ length: 5000 }, (_, i) => `{"msg":"line ${i}","pad":"${"x".repeat(40)}"}`);
  fs.writeFileSync(file, `${all.join("\n")}\n`);
  assert.deepEqual(lastLines(file, 3), all.slice(-3));
  assert.deepEqual(lastLines(file, 2000), all.slice(-2000));
  fs.writeFileSync(file, "only\n");
  assert.deepEqual(lastLines(file, 100), ["only"]);
});

test("logs prints the last lines of <home>/logs/core.log and refuses a bad -n", async () => {
  fs.mkdirSync(path.join(home, "logs"), { recursive: true });
  fs.writeFileSync(path.join(home, "logs", "core.log"), "a\nb\nc\n");
  assert.equal(await printed(() => logs(home, 2, false)), "b\nc");
  await assert.rejects(logs(home, 0, false), /-n is a number/);
});

test("stopCore ends the core, keeps its last output and closes the log, even if a grandchild holds its pipes", async () => {
  const file = path.join(home, "stop.log");
  const log = fs.createWriteStream(file, { flags: "a" });
  await once(log, "open");
  // The core ignores SIGTERM (stopCore must escalate) and leaves a grandchild holding stdout.
  const script = `
    const { spawn } = require("node:child_process");
    process.on("SIGTERM", () => {});
    const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: ["ignore", "inherit", "inherit"] });
    console.log("grandchild " + g.pid);
    setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const [line] = (await once(child.stdout, "data")) as [Buffer];
  const grandchild = Number(/grandchild (\d+)/.exec(String(line))?.[1]);
  try {
    const started = Date.now();
    await stopCore(child, log, 300);
    assert.ok(Date.now() - started < 5000);
    assert.notEqual(child.exitCode ?? child.signalCode, null);
    assert.ok(log.writableFinished);
    assert.match(fs.readFileSync(file, "utf8"), /grandchild \d+/);
  } finally {
    if (grandchild) process.kill(grandchild);
  }
});

test("stopCore with no core running only closes the log", async () => {
  const log = fs.createWriteStream(path.join(home, "idle.log"), { flags: "a" });
  await stopCore(undefined, log);
  assert.ok(log.writableFinished);
});

test("on Windows a core with no pid file is still stopped: found by its command line, and waited for", () => {
  const script = windowsStopScript("C:\\Users\\O'Neil\\.apx\\v2");
  assert.ok(script.includes("Contains('C:\\Users\\O''Neil\\.apx\\v2')"), "the home, its quote doubled for PowerShell");
  assert.ok(script.includes("Contains('service run')"), "the supervisor");
  assert.ok(script.includes("Contains('apps\\core\\src\\main.ts')"), "the core it started");
  assert.ok(!script.includes("service install"), "never the command that is running this");
  assert.match(script, /Wait-Process -Id \$ids -Timeout 10/);
});
