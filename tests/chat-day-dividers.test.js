// Day dividers in the chat transcript: which message opens a new day, and what
// the line above it says.
//
// Imports the web's TypeScript directly (Node strips types natively) — same
// approach as inbox-selection.test.js, for logic with no DOM in it.
//
// Why this is tested rather than eyeballed: every case that goes wrong here is
// invisible for most of a day. A UTC day key is correct until the evening, when
// it cuts tomorrow into tonight; the today/yesterday arithmetic is correct
// until it is done in elapsed hours instead of calendar days; the year only
// shows up wrong in January. A Rocky thread spanning months is exactly where
// each of them would be read as truth.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { dayKey, startsNewDay, dayLabel } = await import(
  path.join(ROOT, "src/interfaces/web/src/lib/chat-dates.ts")
);

// Stand-ins for the two translated words the divider borrows from i18n.
const t = (key) => (key === "chat_ui.day_today" ? "Hoy" : "Ayer");
/** A local wall-clock instant, as the ISO string a message carries. */
const at = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm).toISOString();

test("the day key is the LOCAL calendar day, not the UTC one", () => {
  // 23:30 local on the 4th is already the 5th in UTC anywhere east of the
  // prime meridian's own offset — a UTC key would open a new day in the middle
  // of the reader's evening, every evening.
  assert.equal(dayKey(at(2026, 9, 4, 23, 30)), "2026-09-04");
  assert.equal(dayKey(at(2026, 9, 4, 0, 5)), "2026-09-04");
  // Zero-padded, so the keys compare as strings.
  assert.equal(dayKey(at(2026, 1, 7)), "2026-01-07");
});

test("an undatable timestamp has no day", () => {
  assert.equal(dayKey(undefined), null);
  assert.equal(dayKey(""), null);
  assert.equal(dayKey("not a date"), null);
});

test("the first message opens a day; the next one on the same day does not", () => {
  assert.equal(startsNewDay(undefined, at(2026, 9, 4, 9)), true);
  assert.equal(startsNewDay(at(2026, 9, 4, 9), at(2026, 9, 4, 23, 59)), false);
});

test("crossing midnight opens a day, even ten minutes later", () => {
  assert.equal(startsNewDay(at(2026, 9, 4, 23, 55), at(2026, 9, 5, 0, 5)), true);
});

test("a message with no usable timestamp never opens a day", () => {
  // It would draw a divider labelled with nothing, above a bubble that cannot
  // say when it happened either.
  assert.equal(startsNewDay(at(2026, 9, 4), "not a date"), false);
  assert.equal(startsNewDay(at(2026, 9, 4), undefined), false);
});

test("today and yesterday are named, not dated", () => {
  const now = new Date(2026, 8, 10, 15, 0);
  assert.equal(dayLabel(at(2026, 9, 10, 8), t, { now, locale: "es-AR" }), "Hoy");
  assert.equal(dayLabel(at(2026, 9, 9, 23, 50), t, { now, locale: "es-AR" }), "Ayer");
});

test("yesterday is a calendar day apart, not 24 hours apart", () => {
  // 00:10 today is 40 minutes after 23:30 yesterday. Counted in elapsed hours
  // that is "today"; counted in days — which is what a divider means — it is
  // the day before.
  const now = new Date(2026, 8, 10, 0, 10);
  assert.equal(dayLabel(at(2026, 9, 9, 23, 30), t, { now, locale: "es-AR" }), "Ayer");
});

test("inside the last week the weekday alone says it", () => {
  const now = new Date(2026, 8, 10); // Thursday 10 September 2026
  // Three days back: Monday the 7th.
  const label = dayLabel(at(2026, 9, 7), t, { now, locale: "es-AR" });
  assert.equal(label, "Lunes");
});

test("older than a week, same year: the date without the year", () => {
  const now = new Date(2026, 8, 10);
  const label = dayLabel(at(2026, 6, 4), t, { now, locale: "es-AR" });
  assert.ok(label.includes("4 de junio"), label);
  assert.ok(!label.includes("2026"), label);
  // A divider NAMES the day on screen, so it is Capitalised (AGENTS.md 11a) —
  // es-AR returns "jueves, 4 de junio".
  assert.equal(label[0], label[0].toUpperCase());
});

test("another year spells the year out", () => {
  const now = new Date(2026, 8, 10);
  assert.equal(dayLabel(at(2024, 9, 4), t, { now, locale: "es-AR" }), "4 de septiembre de 2024");
});

test("compact drops the weekday, keeps the date", () => {
  const now = new Date(2026, 8, 10);
  const wide = dayLabel(at(2026, 6, 4), t, { now, locale: "es-AR" });
  const phone = dayLabel(at(2026, 6, 4), t, { now, locale: "es-AR", compact: true });
  assert.equal(phone, "4 de junio");
  assert.ok(wide.length > phone.length, `${wide} vs ${phone}`);
});

test("English reads as English", () => {
  const now = new Date(2026, 8, 10);
  const en = (key) => (key === "chat_ui.day_today" ? "Today" : "Yesterday");
  assert.equal(dayLabel(at(2026, 9, 10), en, { now, locale: "en-US" }), "Today");
  assert.equal(dayLabel(at(2024, 9, 4), en, { now, locale: "en-US" }), "September 4, 2024");
});

test("an undatable timestamp gets no label at all", () => {
  assert.equal(dayLabel("not a date", t, { now: new Date(2026, 8, 10) }), "");
});
