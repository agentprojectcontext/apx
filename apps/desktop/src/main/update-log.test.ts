import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../../core/src/testkit/platform.ts";
import { updateLog } from "./update-log.ts";

test("update steps are appended one per line and an old log moves aside once it is large", async () => {
  await using dir = tempDir("apx-update-log-test-");
  const file = path.join(dir.path, "logs", "update.log");
  const log = updateLog(file);
  log("restart: 2.1.0");
  log("quit");
  assert.match(fs.readFileSync(file, "utf8"), /^\S+ restart: 2\.1\.0\n\S+ quit\n$/);
  fs.writeFileSync(file, "x".repeat(300 * 1024));
  log("check: 2.2.0");
  assert.equal(fs.statSync(`${file}.1`).size, 300 * 1024);
  assert.match(fs.readFileSync(file, "utf8"), /^\S+ check: 2\.2\.0\n$/);
});

test("a log that cannot be written never throws", async () => {
  await using dir = tempDir("apx-update-log-test-");
  const blocked = path.join(dir.path, "file");
  fs.writeFileSync(blocked, "");
  assert.doesNotThrow(() => updateLog(path.join(blocked, "update.log"))("restart: 2.1.0"));
});
