import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { lastLines, logs, stopCore } from "./service.ts";
import { NODE_FLAGS, windowsRunCommand, windowsStopScript } from "./service-files.ts";
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

test("on Windows only an exact home supervisor and its child core may be stopped", () => {
  const home = "C:\\APX's data\\v2";
  const command = windowsRunCommand({
    node: "C:\\APX\\node.exe",
    terminal: "C:\\APX\\apps\\terminal\\src\\main.ts",
    home,
    electron: false,
  });
  const script = windowsStopScript(home, command);
  assert.ok(script.includes("APX''s data"), "the exact home argument, quoted for PowerShell");
  assert.ok(script.includes("$parents -contains $_.ParentProcessId"), "only children of the selected supervisor");
  assert.ok(script.includes("$_.CommandLine -imatch"), "only complete command lines authorize a stop");
  assert.ok(!script.includes(".Contains("), "substrings never authorize a stop");
  assert.ok(!script.includes("service install"), "never the command that is running this");
  assert.match(script, /Wait-Process -Id \$ids -Timeout 10/);
});

for (const packaged of [false, true]) {
  for (const port of [undefined, "7550"]) {
    for (const feed of [undefined, "https://updates.example.com/feed"]) {
      for (const electron of [false, true]) {
        test(`Windows stop uses the registered command: packaged=${packaged}, port=${port}, feed=${Boolean(feed)}, electron=${electron}`, () => {
          const root = packaged ? "C:\\Program Files\\APX\\current" : "C:\\work\\apx";
          const node = `${root}\\${electron ? "electron.exe" : "node.exe"}`;
          const terminal = `${root}\\apps\\terminal\\src\\main.ts`;
          const home = "C:\\APX's data\\v2";
          const command = windowsRunCommand({
            node,
            terminal,
            home,
            electron,
            env: { ...(port ? { APX_PORT: port } : {}), ...(feed ? { APX_RELEASES: feed } : {}) },
          });
          const script = windowsStopScript(home, command);
          const searchedCommand = /-ceq '((?:''|[^'])*)'/.exec(script)?.[1]?.replaceAll("''", "'");
          assert.equal(searchedCommand, command, "stop searches for exactly the registered line");
          const patterns = [...script.matchAll(/-imatch '((?:''|[^'])*)'/g)].map(
            (m) => new RegExp((m[1] as string).replaceAll("''", "'"), "i"),
          );
          assert.equal(patterns.length, 2);
          const supervisor = windowsRunCommand({ node, terminal, home, electron: false });
          assert.match(supervisor, patterns[0] as RegExp);
          assert.doesNotMatch(`${supervisor} --extra`, patterns[0] as RegExp);
          assert.doesNotMatch(supervisor.replace("service run", "service install"), patterns[0] as RegExp);
          assert.doesNotMatch(supervisor.replace(home, `${home}-other`), patterns[0] as RegExp);
          const core = `"${node}" ${NODE_FLAGS.join(" ")} "${root}\\apps\\core\\src\\main.ts"`;
          assert.match(core, patterns[1] as RegExp);
          assert.doesNotMatch(`${core} --extra`, patterns[1] as RegExp);
          if (packaged) assert.ok(script.includes("current"));
        });
      }
    }
  }
}

test("Windows stop refuses unknown commands and entries registered for another home", () => {
  const command = windowsRunCommand({
    node: "C:\\APX\\node.exe",
    terminal: "C:\\APX\\apps\\terminal\\src\\main.ts",
    home: "C:\\data\\one",
    electron: false,
  });
  assert.throws(() => windowsStopScript("C:\\data\\two", command), /no process was stopped/);
  assert.throws(() => windowsStopScript("C:\\data\\one", "node anything"), /no process was stopped/);
});
