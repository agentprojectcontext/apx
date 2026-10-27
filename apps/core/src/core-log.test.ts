import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { coreLogFile, coreLogSink, OUTPUT_SCOPE, parseLine, readCoreLog } from "./core-log.ts";
import { createLog } from "./log.ts";
import { waitFor } from "./testkit/platform.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-core-log-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function logFile(lines: string[]): string {
  const file = coreLogFile(fs.mkdtempSync(path.join(tmp, "home-")));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

const json = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ t: "2026-01-01T00:00:00.000Z", level, scope: "core", msg, ...extra });

test("the newest matching lines come back oldest first, and say when older ones match too", () => {
  const file = logFile(Array.from({ length: 10 }, (_, i) => json("info", `line ${i}`)));
  const r = readCoreLog(file, { limit: 3 });
  assert.equal(r.exists, true);
  assert.deepEqual(
    r.lines.map((l) => l.msg),
    ["line 7", "line 8", "line 9"],
  );
  assert.equal(r.more, true);
  assert.equal(readCoreLog(file, { limit: 50 }).more, false);
});

test("level, scope and text filter the lines; other fields come as detail", () => {
  const file = logFile([
    json("info", "apx core listening", { url: "http://127.0.0.1:7440" }),
    json("warn", "push not delivered", { err: "timeout" }),
    json("error", "channel down", { channel: "acme" }),
    "TypeError: boom",
    "    at run (file.js:1:1)",
    "core exited (1)",
  ]);
  const errors = readCoreLog(file, { limit: 50, level: "error" }).lines;
  assert.deepEqual(
    errors.map((l) => l.msg),
    ["channel down", "TypeError: boom", "at run (file.js:1:1)"],
  );
  assert.equal(errors[0]?.detail, JSON.stringify({ channel: "acme" }));
  const output = readCoreLog(file, { limit: 50, scope: OUTPUT_SCOPE });
  assert.equal(output.lines.length, 3);
  assert.deepEqual(output.scopes, ["core", OUTPUT_SCOPE]);
  assert.deepEqual(
    readCoreLog(file, { limit: 50, q: "TIMEOUT" }).lines.map((l) => l.msg),
    ["push not delivered"],
  );
});

test("a line cut between chunks of a large log is read whole", () => {
  const long = "x".repeat(300 * 1024);
  const file = logFile([json("info", "first"), json("warn", long), json("info", "last")]);
  const r = readCoreLog(file, { limit: 10 });
  assert.deepEqual(
    r.lines.map((l) => l.level),
    ["info", "warn", "info"],
  );
  assert.ok(r.lines[1]?.msg.endsWith("…"));
});

test("no log yet is not an error", () => {
  const r = readCoreLog(path.join(tmp, "none", "core.log"), { limit: 10 });
  assert.deepEqual(r, { exists: false, lines: [], scopes: [], more: false });
});

test("a line that is not the logger's JSON keeps its text", () => {
  assert.deepEqual(parseLine("{not json"), { level: "info", scope: OUTPUT_SCOPE, msg: "{not json" });
});

test("the core's logger writes its home's log file", async () => {
  const home = fs.mkdtempSync(path.join(tmp, "sink-"));
  const write = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const log = createLog("core", false, coreLogSink(home));
    log.warn({ api_key: "not-a-real-one-but-long" }, "hello");
  } finally {
    process.stderr.write = write;
  }
  const line = await waitFor(
    () => readCoreLog(coreLogFile(home), { limit: 5 }).lines[0],
    "the logger's asynchronous file append",
  );
  assert.equal(line?.msg, "hello");
  assert.equal(line?.level, "warn");
  assert.equal(line?.detail, JSON.stringify({ api_key: "[redacted]" }));
});
