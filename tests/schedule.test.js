import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSchedule, computeNextRun } from "../src/daemon/routines.js";

test("parseSchedule — every:<N><unit>", () => {
  assert.deepEqual(parseSchedule("every:60s"), { kind: "every", intervalMs: 60_000 });
  assert.deepEqual(parseSchedule("every:5m"),  { kind: "every", intervalMs: 300_000 });
  assert.deepEqual(parseSchedule("every:2h"),  { kind: "every", intervalMs: 7_200_000 });
  assert.deepEqual(parseSchedule("every:1d"),  { kind: "every", intervalMs: 86_400_000 });
});

test("parseSchedule — once:<iso>", () => {
  const s = parseSchedule("once:2030-01-01T00:00:00Z");
  assert.equal(s.kind, "once");
  assert.equal(s.atMs, Date.parse("2030-01-01T00:00:00Z"));
});

test("parseSchedule — invalid", () => {
  for (const bad of ["", "every:", "every:0", "cron:* * * * *", "weird:thing"]) {
    assert.equal(parseSchedule(bad).kind, "invalid", `expected invalid for ${JSON.stringify(bad)}`);
  }
});

test("computeNextRun — every adds interval to last_run, never schedules in the past", () => {
  const base = Date.parse("2026-05-07T00:00:00Z");
  // Last run was just now → next is base + 60s
  const next1 = computeNextRun({ schedule: "every:60s", last_run_at: "2026-05-07T00:00:00Z" }, base);
  assert.equal(Date.parse(next1), base + 60_000);

  // Last run was way in the past → never schedules in the past, gets pushed to ~now
  const ancient = computeNextRun({ schedule: "every:60s", last_run_at: "2020-01-01T00:00:00Z" }, base);
  assert.ok(Date.parse(ancient) >= base);
  assert.ok(Date.parse(ancient) < base + 1000);
});

test("computeNextRun — once in the past returns null (won't fire again)", () => {
  const base = Date.parse("2026-05-07T00:00:00Z");
  const next = computeNextRun({ schedule: "once:2020-01-01T00:00:00Z", last_run_at: null }, base);
  assert.equal(next, null);
});

test("computeNextRun — once in the future returns the iso", () => {
  const base = Date.parse("2026-05-07T00:00:00Z");
  const future = "2026-12-25T12:00:00Z";
  const next = computeNextRun({ schedule: `once:${future}`, last_run_at: null }, base);
  assert.equal(Date.parse(next), Date.parse(future));
});
