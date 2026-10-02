import assert from "node:assert/strict";
import { test } from "node:test";
import { dueLabel } from "./format.ts";

test("a bare due date is late only from the next day; a timed one from its time", () => {
  const now = new Date(2026, 4, 12, 15, 0);
  assert.equal(dueLabel(new Date(2026, 4, 12, 9, 0).toISOString(), now).late, false, "today, no time");
  assert.equal(dueLabel(new Date(2026, 4, 11, 9, 0).toISOString(), now).late, true, "yesterday");
  assert.equal(dueLabel(new Date(2026, 4, 12, 10, 30).toISOString(), now).late, true, "today at 10:30");
  assert.equal(dueLabel(new Date(2026, 4, 12, 18, 0).toISOString(), now).late, false, "today at 18:00");
});
