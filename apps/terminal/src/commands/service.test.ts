import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { lastLines, logs } from "./service.ts";
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
