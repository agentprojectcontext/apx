import assert from "node:assert/strict";
import { test } from "node:test";
import { prefs } from "../data/prefs.ts";
import { startI18n } from "../i18n/index.ts";
import {
  aheadLabel,
  dayLabel,
  dueLabel,
  duration,
  elapsed,
  formatBytes,
  formatCompact,
  formatNumber,
  formatSeconds,
  hostPath,
  sameDay,
  shortWhen,
} from "./format.ts";

prefs.set({ language: "en" });
await startI18n();

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

test("a count at a glance: as is under a thousand, then K and M", () => {
  assert.equal(formatCompact(950), "950");
  assert.equal(formatCompact(1250), "1.3K");
  assert.equal(formatCompact(12_400), "12K");
  assert.equal(formatCompact(2_430_000), "2.4M");
});

test("list timestamps distinguish today, yesterday, this week and older dates; invalid input stays blank", () => {
  const now = new Date(2026, 4, 12, 15);
  assert.equal(shortWhen(new Date(2026, 4, 12, 10, 30).toISOString(), now), "10:30 AM");
  assert.equal(shortWhen(new Date(2026, 4, 11, 23).toISOString(), now), "Yesterday");
  assert.equal(shortWhen(new Date(2026, 4, 10, 10).toISOString(), now), "Sun");
  assert.equal(shortWhen(new Date(2026, 3, 1, 10).toISOString(), now), "Apr 1");
  assert.equal(shortWhen("invalid", now), "");
});

test("day dividers and future labels retain local date boundaries", () => {
  const now = new Date(2026, 4, 12, 15);
  assert.equal(dayLabel(new Date(2026, 4, 12, 10, 30).toISOString(), now), "Today · 10:30 AM");
  assert.equal(dayLabel(new Date(2026, 4, 11, 10, 30).toISOString(), now), "Yesterday · 10:30 AM");
  assert.equal(dayLabel(new Date(2026, 4, 1, 10, 30).toISOString(), now), "May 1 · 10:30 AM");
  assert.equal(aheadLabel(new Date(2026, 4, 12, 18).toISOString(), now), "Today · 06:00 PM");
  assert.equal(aheadLabel(new Date(2026, 4, 13, 18).toISOString(), now), "Tomorrow · 06:00 PM");
  assert.equal(aheadLabel(new Date(2026, 4, 14, 18).toISOString(), now), "Thu · 06:00 PM");
  assert.equal(aheadLabel(new Date(2026, 5, 1, 18).toISOString(), now), "Jun 1 · 06:00 PM");
  assert.equal(aheadLabel("invalid", now), "");
  assert.equal(sameDay(new Date(2026, 4, 12, 0).toISOString(), new Date(2026, 4, 12, 23, 59).toISOString()), true);
  assert.equal(sameDay(new Date(2026, 4, 12, 23, 59).toISOString(), new Date(2026, 4, 13, 0).toISOString()), false);
});

test("elapsed and duration formatting cover rounding, minute and hour boundaries, future and invalid dates", () => {
  const now = new Date(2026, 4, 12, 15).getTime();
  for (const [ms, label] of [
    [0, "0 s"],
    [59_000, "59 s"],
    [60_000, "1 min"],
    [3_599_000, "59 min"],
    [3_600_000, "1 h 00"],
    [4_620_000, "1 h 17"],
  ] as const)
    assert.equal(elapsed(new Date(now - ms).toISOString(), now), label);
  assert.equal(elapsed(new Date(now + 10_000).toISOString(), now), "0 s");
  assert.equal(elapsed("invalid", now), "");
  for (const [ms, label] of [
    [-100, "0 s"],
    [59_499, "59 s"],
    [59_500, "1 min"],
    [190_000, "3 min 10 s"],
    [3_900_000, "1 h 05"],
  ] as const)
    assert.equal(duration(ms), label);
});

test("file and number formatting preserve boundary sizes, decimal precision and safe URL display", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1024 * 1024), "1 MB");
  assert.equal(formatNumber(12345), "12,345");
  assert.equal(formatSeconds(3), "3.0 s");
  assert.equal(hostPath("https://user:password@example.com/login?q=secret#fragment"), "example.com/login");
  assert.equal(hostPath("https://example.com/"), "example.com");
  assert.equal(hostPath("not a URL"), "not a URL");
});
