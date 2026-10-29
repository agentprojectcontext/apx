// The schedule card's choices to a cron and back (DECISIONS.md#d-182).
import assert from "node:assert/strict";
import { test } from "node:test";
import { EVERY_START, everyCron, readCron, timesCron } from "./schedule-form.ts";

test("fixed times: one cron per group of days with the same times, a range for a run of days", () => {
  assert.equal(timesCron({}), "");
  assert.equal(timesCron({ 1: ["08:30"], 2: ["08:30"], 3: ["08:30"], 4: ["08:30"], 5: ["08:30"] }), "30 8 * * 1-5");
  // Monday at 04:00, 05:00 and 06:00; Wednesday and Friday at 09:15.
  assert.equal(
    timesCron({ 1: ["04:00", "06:00", "05:00"], 3: ["09:15"], 5: ["09:15"] }),
    "0 4,5,6 * * 1; 15 9 * * 3,5",
  );
  // Times on different minutes of the same days need a cron each; Sunday is cron's 0.
  assert.equal(timesCron({ 0: ["10:00", "10:30"], 6: ["10:00", "10:30"] }), "0 10 * * 0,6; 30 10 * * 0,6");
  assert.equal(
    timesCron({ 0: ["07:00"], 1: ["07:00"], 2: ["07:00"], 3: ["07:00"], 4: ["07:00"], 5: ["07:00"], 6: ["07:00"] }),
    "0 7 * * *",
  );
  // Past seven crons it can't be kept as one schedule.
  const busy = { 1: ["00:01", "00:02", "00:03", "00:04"], 2: ["00:05", "00:06", "00:07", "00:08"] };
  assert.equal(timesCron(busy), undefined);
});

test("a cron reads back as the choices that make it", () => {
  assert.deepEqual(readCron("0 4,5,6 * * 1; 15 9 * * 3,5"), {
    mode: "times",
    days: { 1: ["04:00", "05:00", "06:00"], 3: ["09:15"], 5: ["09:15"] },
  });
  assert.deepEqual(readCron("30 8 * * 1-5"), {
    mode: "times",
    days: { 1: ["08:30"], 2: ["08:30"], 3: ["08:30"], 4: ["08:30"], 5: ["08:30"] },
  });
  assert.deepEqual(readCron("0 10 * * 7"), { mode: "times", days: { 0: ["10:00"] } });
  assert.deepEqual(readCron("*/15 * * * *"), { mode: "every", every: { ...EVERY_START, unit: "minutes", n: 15 } });
  assert.deepEqual(readCron("0 */6 * * *"), { mode: "every", every: { ...EVERY_START, unit: "hours", n: 6 } });
  assert.deepEqual(readCron("0 3 * * *"), { mode: "every", every: { ...EVERY_START, unit: "days", at: "03:00" } });
  assert.deepEqual(readCron("45 7 1 */3 *"), {
    mode: "every",
    every: { ...EVERY_START, unit: "months", n: 3, at: "07:45", day: 1 },
  });
  // What the card can't show stays a hand-written cron.
  for (const cron of ["*/7 * * * *", "0 9 1,15 * *", "0 9-17 * * 1-5", "", "every day"])
    assert.deepEqual(readCron(cron), { mode: "cron" }, cron);
});

test("every N units is one cron, and reads back the same", () => {
  const cases = [
    { ...EVERY_START, unit: "minutes" as const, n: 5 },
    { ...EVERY_START, unit: "hours" as const, n: 2 },
    { ...EVERY_START, unit: "days" as const, n: 2, at: "06:30" },
    { ...EVERY_START, unit: "months" as const, n: 12, at: "08:00", day: 28 },
  ];
  for (const every of cases) assert.deepEqual(readCron(everyCron(every)), { mode: "every", every }, everyCron(every));
  // Weekly is a day and a time: it reads back as fixed times.
  assert.equal(everyCron({ ...EVERY_START, unit: "weeks", weekday: 0, at: "18:00" }), "0 18 * * 0");
  assert.deepEqual(readCron("0 18 * * 0"), { mode: "times", days: { 0: ["18:00"] } });
});
