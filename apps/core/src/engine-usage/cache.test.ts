import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineUsageReport } from "@apx/protocol";
import { cachedEngineUsage } from "./cache.ts";

const report = (reset?: number): EngineUsageReport => ({
  checked_at: new Date(0).toISOString(),
  engines: [
    {
      id: "codex",
      label: "Codex",
      cli_installed: true,
      available: true,
      status: "ok",
      source: "codex_app_server",
      windows: [
        {
          id: "primary",
          used_percent: 25,
          ...(reset === undefined ? {} : { resets_at: new Date(reset).toISOString() }),
        },
      ],
    },
  ],
});

test("cache shares concurrent requests, retains failures and expires after one minute", async () => {
  let now = 0;
  let calls = 0;
  const read = cachedEngineUsage(
    async () => {
      calls++;
      return { checked_at: new Date(now).toISOString(), engines: [] };
    },
    () => now,
  );
  const first = read();
  assert.equal(read(), first);
  await first;
  now = 59_999;
  await read();
  assert.equal(calls, 1);
  now = 60_000;
  await read();
  assert.equal(calls, 2);
  now = 0;
  await read();
  assert.equal(calls, 3);
});

test("a passed quota reset invalidates the cache without inventing a new balance", async () => {
  let now = 0;
  let calls = 0;
  const read = cachedEngineUsage(
    async () => {
      calls++;
      return report(1000);
    },
    () => now,
  );
  await read();
  now = 999;
  await read();
  assert.equal(calls, 1);
  now = 1000;
  assert.equal((await read()).engines[0]?.windows[0]?.used_percent, 25);
  assert.equal(calls, 2);
  now = 1001;
  await read();
  assert.equal(calls, 2);
});

test("a rejected probe is retryable", async () => {
  let calls = 0;
  const read = cachedEngineUsage(async () => {
    if (++calls === 1) throw new Error("Probe unavailable");
    return report();
  });
  await assert.rejects(read(), /Probe unavailable/);
  assert.equal((await read()).engines[0]?.available, true);
});
