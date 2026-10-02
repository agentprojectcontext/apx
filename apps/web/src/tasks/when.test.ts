import assert from "node:assert/strict";
import { test } from "node:test";
import { duePresets, momentOf, pickerValue, remindAt, reminderOf } from "./when.ts";

test("a bare day is 09:00 both ways; other times keep their time", () => {
  assert.equal(pickerValue(new Date(2026, 9, 5, 9, 0).toISOString()), "2026-10-05");
  assert.equal(pickerValue(new Date(2026, 9, 5, 18, 30).toISOString()), "2026-10-05T18:30");
  assert.equal(momentOf("2026-10-05").getHours(), 9);
  assert.equal(momentOf("2026-10-05T18:30").getMinutes(), 30);
});

test("reminders: when due, an hour or a day before, or any other moment", () => {
  assert.equal(remindAt("2026-10-05", "due", undefined), undefined);
  assert.equal(remindAt("2026-10-05", "hour", undefined), "2026-10-05T08:00");
  assert.equal(remindAt("2026-10-05T18:30", "day", undefined), "2026-10-04T18:30");
  assert.equal(remindAt("2026-10-05", "custom", "2026-10-01T10:00"), "2026-10-01T10:00");
  assert.equal(reminderOf("2026-10-05", undefined), "due");
  assert.equal(reminderOf("2026-10-05", "2026-10-05T08:00"), "hour");
  assert.equal(reminderOf("2026-10-05T18:30", "2026-10-04T18:30"), "day");
  assert.equal(reminderOf("2026-10-05", "2026-10-02T11:00"), "custom");
});

test("quick dates: today, tomorrow and the next Monday (never today)", () => {
  const friday = new Date(2026, 9, 2, 15);
  assert.deepEqual(
    duePresets(friday).map((p) => p.value),
    ["2026-10-02", "2026-10-03", "2026-10-05"],
  );
  const monday = new Date(2026, 9, 5, 15);
  assert.equal(duePresets(monday)[2]?.value, "2026-10-12");
});
