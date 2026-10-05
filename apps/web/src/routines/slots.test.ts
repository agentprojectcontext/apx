import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoutineRun } from "@apx/protocol";
import { weeklyCron, weeklyOf } from "./cron.ts";
import { activationSlots, expectedTimes } from "./slots.ts";

const run = (id: string, at: Date): RoutineRun => ({
  run_id: id,
  thread_id: `t-${id}`,
  state: "completed",
  started_at: at.toISOString(),
});
// Wednesday 2026-10-07, 21:30 local.
const now = new Date(2026, 9, 7, 21, 30);

test("weekly crons read and write back", () => {
  assert.deepEqual(weeklyOf("30 8 * * 1-5"), { days: [1, 2, 3, 4, 5], time: "08:30" });
  assert.equal(weeklyOf("*/5 * * * *"), undefined);
  assert.equal(weeklyCron([1, 2, 3, 4, 5], "08:30"), "30 8 * * 1-5");
});

test("a daily cron expects one moment a day, the last one today when it has passed", () => {
  const times = expectedTimes({ kind: "cron", cron: "0 9 * * *" }, now, 3) ?? [];
  assert.deepEqual(
    times.map((d) => [d.getDate(), d.getHours()]),
    [
      [5, 9],
      [6, 9],
      [7, 9],
    ],
  );
  // Before 09:00 today's has not fired yet.
  const early = expectedTimes({ kind: "cron", cron: "0 9 * * *" }, new Date(2026, 9, 7, 8, 0), 1) ?? [];
  assert.equal(early[0]?.getDate(), 6);
});

test("weekdays only skip the weekend", () => {
  const times = expectedTimes({ kind: "cron", cron: "0 9 * * 1-5" }, now, 5) ?? [];
  // Thu 1, Fri 2, Mon 5, Tue 6, Wed 7.
  assert.deepEqual(
    times.map((d) => d.getDate()),
    [1, 2, 5, 6, 7],
  );
});

test("an every-N schedule lines up with its next firing", () => {
  const next = new Date(2026, 9, 7, 22, 15).toISOString();
  const times = expectedTimes({ kind: "every", minutes: 60 }, now, 3, next) ?? [];
  assert.deepEqual(
    times.map((d) => `${d.getHours()}:${d.getMinutes()}`),
    ["19:15", "20:15", "21:15"],
  );
});

test("once, by hand and unusual crons cannot say when they fired", () => {
  assert.equal(expectedTimes({ kind: "manual" }, now, 3), undefined);
  assert.equal(expectedTimes({ kind: "once", at: now.toISOString() }, now, 3), undefined);
  assert.equal(expectedTimes({ kind: "cron", cron: "0 9 1 * *" }, now, 3), undefined);
});

test("every row has n bars: runs sit in their slot, the rest stay empty", () => {
  const slots = activationSlots(
    { kind: "cron", cron: "0 9 * * *" },
    [run("b", new Date(2026, 9, 7, 9, 0, 3)), run("a", new Date(2026, 9, 5, 9, 0, 1))],
    now,
    undefined,
    4,
  );
  assert.equal(slots.length, 4);
  assert.deepEqual(
    slots.map((s) => s.run?.run_id ?? "-"),
    ["-", "a", "-", "b"],
  );
  assert.ok(slots.every((s) => s.at));
});

test("a run by hand between two firings counts for the earlier one; the newest wins", () => {
  const slots = activationSlots(
    { kind: "cron", cron: "0 9 * * *" },
    [run("late", new Date(2026, 9, 7, 21, 0)), run("on-time", new Date(2026, 9, 7, 9, 0))],
    now,
    undefined,
    2,
  );
  assert.deepEqual(
    slots.map((s) => s.run?.run_id ?? "-"),
    ["-", "late"],
  );
});

test("without a schedule the last runs are padded on the left", () => {
  const slots = activationSlots({ kind: "manual" }, [run("2", now), run("1", new Date(2026, 9, 1))], now, undefined, 5);
  assert.deepEqual(
    slots.map((s) => s.run?.run_id ?? "-"),
    ["-", "-", "-", "1", "2"],
  );
  assert.equal(slots[0]?.at, undefined);
});
