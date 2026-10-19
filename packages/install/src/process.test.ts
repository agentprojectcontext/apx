import assert from "node:assert/strict";
import { test } from "node:test";
import { runProcess } from "./process.ts";

test("a detached app that immediately fails never reports a successful launch", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.exit(3)"], {
      signal: AbortSignal.timeout(5000),
      detached: true,
      env: { ...process.env },
    }),
    /failed to start/,
  );
});

test("native launchers wait for the actual exit status", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.exit(4)"], {
      signal: AbortSignal.timeout(5000),
      env: { ...process.env },
    }),
    /failed/,
  );
  await runProcess(process.execPath, ["-e", "process.exit(0)"], {
    signal: AbortSignal.timeout(5000),
    env: { ...process.env },
  });
});

test("a missing launcher reports an error", async () => {
  await assert.rejects(
    runProcess("apx-missing-launcher", [], {
      signal: AbortSignal.timeout(5000),
      detached: true,
      env: { ...process.env },
    }),
    /ENOENT/,
  );
});
