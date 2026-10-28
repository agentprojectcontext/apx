import assert from "node:assert/strict";
import { test } from "node:test";
import { type CalendarEvent, dueEvents, eventLines } from "./calendar-reminders.ts";

const now = new Date("2026-05-04T17:55:00-03:00");
const ev = (id: string, start: string, more: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: id,
  start,
  all_day: false,
  ...more,
});

test("an event is due once it starts within the lead time, and only once", () => {
  const events = [
    ev("doctor", "2026-05-04T18:20:00-03:00"),
    ev("meeting", "2026-05-04T18:30:00-03:00"),
    ev("later", "2026-05-04T19:00:00-03:00"),
    ev("ongoing", "2026-05-04T17:30:00-03:00"),
  ];
  const first = dueEvents(events, {}, now, 30);
  assert.deepEqual(
    first.due.map((e) => e.id),
    ["doctor"],
    "18:30 is 35 minutes away, 19:00 further, and what already started is not told",
  );
  const again = dueEvents(events, first.told, new Date(now.getTime() + 5 * 60_000), 30);
  assert.deepEqual(
    again.due.map((e) => e.id),
    ["meeting"],
    "five minutes later the 18:30 comes in; the doctor is not told twice",
  );
});

test("a moved event is told again at its new time, and what started leaves the record", () => {
  const first = dueEvents([ev("call", "2026-05-04T18:10:00-03:00")], {}, now, 30);
  const moved = dueEvents([ev("call", "2026-05-04T18:15:00-03:00")], first.told, now, 30);
  assert.equal(moved.due.length, 1);
  const after = dueEvents([], moved.told, new Date("2026-05-04T18:20:00-03:00"), 30);
  assert.deepEqual(after.told, {}, "both starts are past");
});

test("all-day, declined and cancelled events are never reminded", () => {
  const due = dueEvents(
    [
      ev("holiday", "2026-05-04", { all_day: true }),
      ev("declined", "2026-05-04T18:00:00-03:00", { declined: true }),
      ev("cancelled", "2026-05-04T18:00:00-03:00", { status: "cancelled" }),
    ],
    {},
    now,
    60,
  );
  assert.deepEqual(due.due, []);
});

test("each event line says what, when, in how many minutes and where", () => {
  const line = eventLines([ev("doctor", "2026-05-04T18:20:00-03:00", { location: "Clinic" })], now);
  assert.deepEqual(JSON.parse(line), {
    title: "doctor",
    start: "2026-05-04T18:20:00-03:00",
    in_minutes: 25,
    location: "Clinic",
  });
});
