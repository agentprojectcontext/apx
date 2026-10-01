import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSchedule, nextRun, parseCron } from "./schedule.ts";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const next = (cron: string, from: Date) => nextRun({ kind: "cron", cron }, from);

test("cron: daily, weekdays, steps, lists, month ends and the day-or-weekday rule", () => {
  assert.deepEqual(next("30 8 * * *", at(2026, 10, 1, 9)), at(2026, 10, 2, 8, 30));
  assert.deepEqual(next("30 8 * * *", at(2026, 10, 1, 7)), at(2026, 10, 1, 8, 30));
  // Monday to Friday at 9: from Friday 10:00 the next is Monday.
  assert.deepEqual(next("0 9 * * 1-5", at(2026, 10, 2, 10)), at(2026, 10, 5, 9));
  assert.deepEqual(next("*/15 * * * *", at(2026, 10, 1, 9, 7)), at(2026, 10, 1, 9, 15));
  assert.deepEqual(next("0 8,20 * * *", at(2026, 10, 1, 9)), at(2026, 10, 1, 20));
  // The 31st skips months without one.
  assert.deepEqual(next("0 0 31 * *", at(2026, 10, 31, 1)), at(2026, 12, 31, 0));
  // Day 1 or a Sunday, whichever comes first.
  assert.deepEqual(next("0 12 1 * 0", at(2026, 10, 2)), at(2026, 10, 4, 12));
  assert.deepEqual(next("0 12 * * 7", at(2026, 10, 2)), at(2026, 10, 4, 12));
});

test("bad crons and schedules are refused with a reason", () => {
  assert.throws(() => parseCron("* * *"), /five fields/);
  assert.throws(() => parseCron("61 * * * *"), /outside/);
  assert.throws(() => parseCron("*/0 * * * *"), /step/);
  assert.throws(() => checkSchedule({ kind: "every", minutes: 0 }), /5 minutes/);
  assert.throws(() => checkSchedule({ kind: "once", at: "tomorrow-ish" }), /not a date/);
});

test("every, once and manual", () => {
  const now = at(2026, 10, 1, 10);
  assert.deepEqual(nextRun({ kind: "every", minutes: 30 }, now, at(2026, 10, 1, 9, 45)), at(2026, 10, 1, 10, 15));
  // Late (the core was off): soon, not in the past.
  assert.deepEqual(nextRun({ kind: "every", minutes: 30 }, now, at(2026, 10, 1, 6)), at(2026, 10, 1, 10, 1));
  assert.deepEqual(nextRun({ kind: "once", at: at(2026, 10, 1, 12).toISOString() }, now), at(2026, 10, 1, 12));
  assert.equal(nextRun({ kind: "once", at: at(2026, 10, 1, 12).toISOString() }, now, now), undefined);
  assert.equal(nextRun({ kind: "manual" }, now), undefined);
});

test("weekday 7 is Sunday inside ranges too; empty items and */N day fields follow cron", () => {
  // Friday 2026-10-02 10:00: 5-7 is Fri-Sun, so the next is Saturday.
  assert.deepEqual(next("0 9 * * 5-7", at(2026, 10, 2, 10)), at(2026, 10, 3, 9));
  assert.deepEqual(next("0 9 * * 0-7", at(2026, 10, 2, 10)), at(2026, 10, 3, 9));
  assert.throws(() => parseCron("1, * * * *"), /empty item/);
  // */2 in the day field restricts with AND: odd days that are also Mondays.
  assert.deepEqual(next("0 9 */2 * 1", at(2026, 10, 1)), at(2026, 10, 5, 9));
  assert.deepEqual(next("0 9 */2 * 1", at(2026, 10, 6)), at(2026, 10, 19, 9));
});

test("a clock change never sends the next run back in time", () => {
  const tz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    // 2026-11-01 01:35 EST (the repeated hour): the next five-minute slot is 10 minutes later in real time... or 5.
    const from = new Date("2026-11-01T06:35:00Z");
    const n = nextRun({ kind: "cron", cron: "*/5 * * * *" }, from);
    assert.ok(n && n.getTime() > from.getTime(), "after `from`");
    assert.equal(n?.getTime(), from.getTime() + 5 * 60_000);
    // Spring forward (2026-03-08 02:00 does not exist): a 02:30 daily runs on the next day that has it.
    const spring = nextRun({ kind: "cron", cron: "30 2 * * *" }, new Date("2026-03-08T06:00:00Z"));
    assert.ok(spring && spring.getTime() > new Date("2026-03-08T06:00:00Z").getTime());
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});
