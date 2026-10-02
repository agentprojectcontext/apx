import assert from "node:assert/strict";
import { test } from "node:test";
import { dueLabel, formatBytes } from "./format.ts";

test("a bare due date is late only from the next day; a timed one from its time", () => {
  const now = new Date(2026, 4, 12, 15, 0);
  assert.equal(dueLabel(new Date(2026, 4, 12, 9, 0).toISOString(), now).late, false, "today, no time");
  assert.equal(dueLabel(new Date(2026, 4, 11, 9, 0).toISOString(), now).late, true, "yesterday");
  assert.equal(dueLabel(new Date(2026, 4, 12, 10, 30).toISOString(), now).late, true, "today at 10:30");
  assert.equal(dueLabel(new Date(2026, 4, 12, 18, 0).toISOString(), now).late, false, "today at 18:00");
});

test("a file's size: bytes under 1 KB, KB rounded up, MB with one decimal", () => {
  assert.equal(formatBytes(54), "54 B");
  assert.equal(formatBytes(2000), "2 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5 MB");
});
