import assert from "node:assert/strict";
import { test } from "node:test";
import { everyMinutes, everyParts, scheduleOfKind, scheduleValid } from "./edit.ts";

test("every N minutes reads in the largest unit that fits, and back", () => {
  assert.deepEqual(everyParts(30), { n: 30, unit: "minutes" });
  assert.deepEqual(everyParts(120), { n: 2, unit: "hours" });
  assert.deepEqual(everyParts(2880), { n: 2, unit: "days" });
  assert.deepEqual(everyParts(90), { n: 90, unit: "minutes" });
  assert.equal(everyMinutes(3, "hours"), 180);
});

test("a new kind starts somewhere sensible", () => {
  const now = new Date(2026, 9, 7, 14, 0);
  assert.deepEqual(scheduleOfKind("cron", now), { kind: "cron", cron: "0 9 * * 1-5" });
  assert.deepEqual(scheduleOfKind("every", now), { kind: "every", minutes: 60 });
  assert.deepEqual(scheduleOfKind("once", now), { kind: "once", at: new Date(2026, 9, 8, 9, 0).toISOString() });
  assert.deepEqual(scheduleOfKind("manual", now), { kind: "manual" });
});

test("only what the core takes can be saved", () => {
  assert.equal(scheduleValid({ kind: "cron", cron: "30 8 * * 1-5" }), true);
  assert.equal(scheduleValid({ kind: "cron", cron: "30 8 * *" }), false);
  assert.equal(scheduleValid({ kind: "every", minutes: 4 }), false);
  assert.equal(scheduleValid({ kind: "every", minutes: 5 }), true);
  assert.equal(scheduleValid({ kind: "once", at: "nope" }), false);
  assert.equal(scheduleValid({ kind: "manual" }), true);
});
