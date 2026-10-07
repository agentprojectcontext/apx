import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, ahead, dayLabel, dueWhen, elapsed, listWhen } from "./format.ts";

// A Wednesday afternoon, local time.
const now = new Date(2026, 9, 7, 14, 39);
const at = (d: number, h = 0, m = 0) => new Date(2026, 9, 7 + d, h, m).toISOString();

test("a chat row shows the hour today, yesterday by name, and the date before that", () => {
  assert.equal(listWhen(at(0, 9, 5), now, "es"), "09:05");
  assert.equal(listWhen(at(-1, 23), now, "es"), "Ayer");
  assert.equal(listWhen(at(-1, 23), now, "en"), "Yesterday");
  assert.match(listWhen(new Date(2026, 8, 11).toISOString(), now, "es"), /^11 sept?\.?$/);
  assert.match(listWhen(new Date(2025, 8, 11).toISOString(), now, "es"), /2025/);
  assert.equal(listWhen(undefined, now, "es"), "");
});

test("a due date reads as today, tomorrow or a capitalised weekday, with the hour when one is set", () => {
  assert.equal(dueWhen(at(0), now, "es"), "Hoy");
  assert.equal(dueWhen(at(0, 18), now, "es"), "Hoy 18:00");
  assert.equal(dueWhen(at(1), now, "es"), "Mañana");
  assert.equal(dueWhen(at(-1, 10), now, "es"), "Ayer");
  assert.equal(dueWhen(at(2), now, "es"), "Vie");
  assert.equal(dueWhen(at(2), now, "en"), "Fri");
  assert.equal(dueWhen(undefined, now, "es"), "—");
});

test("relative times count back and forward in the owner's language", () => {
  assert.equal(ago(new Date(now.getTime() - 18 * 60_000).toISOString(), now, "es"), "hace 18 min");
  assert.equal(ago(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now, "en"), "3 h ago");
  assert.equal(ago(now.toISOString(), now, "es"), "Recién");
  assert.equal(ahead(new Date(now.getTime() + 12 * 60_000).toISOString(), now, "es"), "en 12 min");
  assert.equal(ahead(at(1, 8), now, "es"), "Mañana 08:00");
  assert.equal(ahead(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now, "es"), "hace 3 h");
  assert.equal(elapsed(new Date(now.getTime() - 41 * 60_000).toISOString(), now, "es"), "41 min");
  assert.equal(elapsed(new Date(now.getTime() - 65 * 60_000).toISOString(), now, "es"), "1 h 5 min");
});

test("a transcript's day reads Today, Yesterday or the date", () => {
  assert.equal(dayLabel(at(0, 9), now, "es"), "Hoy");
  assert.equal(dayLabel(at(-1, 9), now, "en"), "Yesterday");
  assert.match(dayLabel(new Date(2026, 8, 11).toISOString(), now, "es"), /^11 sept?\.?$/);
});
