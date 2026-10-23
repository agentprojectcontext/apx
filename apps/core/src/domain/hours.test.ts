import assert from "node:assert/strict";
import { test } from "node:test";
import { localTime, withinHours } from "./hours.ts";

const BA = "America/Argentina/Buenos_Aires";
const MADRID = "Europe/Madrid";
const weekdays = { days: [1, 2, 3, 4, 5], from: "08:00", to: "22:00" };

test("hours are read on the clocks of the owner's time zone, not the machine's", () => {
  // 2026-10-21 is a Wednesday; 01:00 UTC is 22:00 of Tuesday in Buenos Aires (UTC-3).
  const at = new Date("2026-10-21T01:00:00Z");
  assert.deepEqual(localTime(at, BA), { day: 2, minutes: 22 * 60 });
  assert.equal(withinHours(weekdays, at, BA), false);
  assert.equal(withinHours(weekdays, new Date("2026-10-21T00:59:00Z"), BA), true);
  // The same instant is 03:00 of Wednesday in Madrid (UTC+2 in October).
  assert.equal(withinHours(weekdays, at, MADRID), false);
  assert.equal(withinHours(weekdays, new Date("2026-10-21T06:00:00Z"), MADRID), true);
});

test("the end time is not inside the hours and the start time is", () => {
  assert.equal(withinHours(weekdays, new Date("2026-10-21T11:00:00Z"), BA), true); // 08:00
  assert.equal(withinHours(weekdays, new Date("2026-10-21T10:59:00Z"), BA), false); // 07:59
});

test("a day left out is closed all day", () => {
  // Saturday 2026-10-24, noon in Buenos Aires.
  assert.equal(withinHours(weekdays, new Date("2026-10-24T15:00:00Z"), BA), false);
});

test("hours past midnight belong to the day they start on", () => {
  const nights = { days: [5], from: "20:00", to: "02:00" }; // Friday night only
  assert.equal(withinHours(nights, new Date("2026-10-23T23:30:00Z"), BA), true); // Fri 20:30
  assert.equal(withinHours(nights, new Date("2026-10-24T04:30:00Z"), BA), true); // Sat 01:30
  assert.equal(withinHours(nights, new Date("2026-10-24T05:00:00Z"), BA), false); // Sat 02:00
  assert.equal(withinHours(nights, new Date("2026-10-17T04:30:00Z"), BA), true); // Sat 01:30 of the week before
  assert.equal(withinHours(nights, new Date("2026-10-23T04:30:00Z"), BA), false); // Fri 01:30: Thursday did not open
});

test("the same time twice is the whole day", () => {
  const sundays = { days: [0], from: "00:00", to: "00:00" };
  assert.equal(withinHours(sundays, new Date("2026-10-25T03:00:00Z"), BA), true); // Sun 00:00
  assert.equal(withinHours(sundays, new Date("2026-10-26T02:59:00Z"), BA), true); // Sun 23:59
  assert.equal(withinHours(sundays, new Date("2026-10-26T03:00:00Z"), BA), false); // Mon 00:00
});

test("a daylight saving change moves the hours with the wall clock", () => {
  // Madrid leaves summer time on 2026-10-25: 08:00 is 06:00 UTC before and 07:00 UTC after.
  const every = { days: [0, 1, 2, 3, 4, 5, 6], from: "08:00", to: "22:00" };
  assert.equal(withinHours(every, new Date("2026-10-24T06:00:00Z"), MADRID), true);
  assert.equal(withinHours(every, new Date("2026-10-26T06:00:00Z"), MADRID), false); // 07:00 local
  assert.equal(withinHours(every, new Date("2026-10-26T07:00:00Z"), MADRID), true);
});
