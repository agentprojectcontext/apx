// Unit tests for the unified logger in core/logging.js.
//
// We point APX_HOME at a temp dir before importing the module (the LOG_DIR
// constant is captured at import time), so the test never touches the real
// ~/.apx/logs/apx.log.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-logging-"));
process.env.HOME = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const {
  log, logInfo, logWarn, logError,
  formatLogLine, loggerFor, callableLogger,
  APX_LOG_PATH,
} = await import("../src/core/logging.js");

function readLog() {
  if (!fs.existsSync(APX_LOG_PATH)) return [];
  return fs.readFileSync(APX_LOG_PATH, "utf8").split("\n").filter(Boolean);
}
function clearLog() {
  try { fs.rmSync(APX_LOG_PATH); } catch {}
}

test("formatLogLine — basic shape, padded level, module tag, optional meta", () => {
  const line = formatLogLine("INFO", "telegram", "audio saved");
  assert.match(line, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO \] \[telegram\] audio saved$/);

  const withMeta = formatLogLine("ERROR", "whisper", "fetch failed", { attempt: 2 });
  assert.match(withMeta, /\[ERROR\] \[whisper\] fetch failed \{"attempt":2\}$/);
});

test("formatLogLine — unknown level falls back to INFO", () => {
  const line = formatLogLine("verbose", "x", "y");
  assert.match(line, /\[INFO \]/);
});

test("formatLogLine — multiline messages are collapsed to one line", () => {
  const line = formatLogLine("WARN", "x", "line1\nline2");
  assert.match(line, /line1 line2/);
  assert.equal(line.match(/\n/g)?.length, undefined);
});

test("log() writes to APX_LOG_PATH and returns the line", () => {
  clearLog();
  const line = logInfo("daemon", "hello");
  const lines = readLog();
  assert.equal(lines.length, 1);
  assert.equal(lines[0], line);
});

test("logInfo / logWarn / logError all write with the right level tag", () => {
  clearLog();
  logInfo("a", "i");
  logWarn("a", "w");
  logError("a", "e");
  const lines = readLog();
  assert.equal(lines.length, 3);
  assert.match(lines[0], /\[INFO \] \[a\] i$/);
  assert.match(lines[1], /\[WARN \] \[a\] w$/);
  assert.match(lines[2], /\[ERROR\] \[a\] e$/);
});

test("logger redacts secret keys in meta — token / api_key / bot_token", () => {
  clearLog();
  logInfo("telegram", "channel ready", {
    bot_token: "ABC123",
    chat_id: "42",
    api_key: "sk-XXXX",
    authorization: "Bearer SECRET",
    safe_field: "ok",
  });
  const line = readLog()[0];
  assert.match(line, /"bot_token":"\[redacted\]"/);
  assert.match(line, /"api_key":"\[redacted\]"/);
  assert.match(line, /"authorization":"\[redacted\]"/);
  assert.match(line, /"safe_field":"ok"/);
  assert.match(line, /"chat_id":"42"/);
});

test("logger never throws even with unserializable meta (circular)", () => {
  clearLog();
  const a = {}; const b = { a }; a.b = b;
  // Must not throw despite the cycle.
  assert.doesNotThrow(() => logInfo("x", "circular meta test", a));
  const lines = readLog();
  assert.equal(lines.length, 1);
});

test("loggerFor returns a module-bound logger with info/warn/error", () => {
  clearLog();
  const tg = loggerFor("telegram");
  tg.info("up");
  tg.warn("slow");
  tg.error("dead");
  const lines = readLog();
  assert.equal(lines.length, 3);
  assert.match(lines[0], /\[telegram\] up$/);
  assert.match(lines[1], /\[WARN \] \[telegram\] slow$/);
  assert.match(lines[2], /\[ERROR\] \[telegram\] dead$/);
});

test("callableLogger is callable AND has .warn/.error methods", () => {
  clearLog();
  const log = callableLogger("daemon");
  log("started");          // shorthand → INFO
  log.warn("disk slow");
  log.error("crash");
  const lines = readLog();
  assert.equal(lines.length, 3);
  assert.match(lines[0], /\[INFO \] \[daemon\] started$/);
  assert.match(lines[1], /\[WARN \] \[daemon\] disk slow$/);
  assert.match(lines[2], /\[ERROR\] \[daemon\] crash$/);
});

test("module tag truncated to 24 chars to keep columns aligned", () => {
  clearLog();
  logInfo("very-long-module-name-that-exceeds-the-limit", "x");
  const line = readLog()[0];
  // Find [module] segment — at most 24 chars inside.
  const m = line.match(/\] \[([^\]]+)\] x$/);
  assert.ok(m);
  assert.ok(m[1].length <= 24, `module tag too long: "${m[1]}"`);
});
