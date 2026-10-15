import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { formatLine, logsCommand } from "./logs.ts";
import { printed } from "./testing.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-logs-cmd-"));
after(() => fs.rmSync(home, { recursive: true, force: true }));

test("a log line prints as time, level, scope, message and its fields", () => {
  assert.equal(
    formatLine({
      t: "2026-01-01T10:20:30.000Z",
      level: "warn",
      scope: "core",
      msg: "push not delivered",
      detail: '{"err":"x"}',
    }),
    '2026-01-01 10:20:30  WARN   core  push not delivered  {"err":"x"}',
  );
});

test("with no core answering, apx logs reads this computer's log file", async () => {
  const before = process.env.APX_HOME;
  process.env.APX_HOME = home;
  try {
    fs.mkdirSync(path.join(home, "logs"), { recursive: true });
    fs.writeFileSync(path.join(home, "logs", "core.log"), "a\nb\nc\n");
    const down = "http://127.0.0.1:9";
    const client = new ApxClient({ url: down });
    assert.equal(await printed(() => logsCommand(client, down, { lines: "2" })), "b\nc");
    await assert.rejects(logsCommand(client, down, { level: "debug" }), /--level is info, warn or error/);
  } finally {
    if (before === undefined) delete process.env.APX_HOME;
    else process.env.APX_HOME = before;
  }
});
