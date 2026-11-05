import assert from "node:assert/strict";
import { test } from "node:test";
import { quickWindows, resetLabel, tightestWindow, usageLines, windowLabel } from "./engineUsageModel.ts";

const translate = (key: string, vars?: Record<string, string | number>) =>
  `${key}${vars ? `:${Object.values(vars).join("|")}` : ""}`;
const now = new Date("2026-01-05T10:00:00.000Z");
const engine = (
  id: string,
  windows: { id: "primary" | "secondary"; used_percent: number; window_minutes?: number; resets_at?: string }[],
) => ({
  id,
  label: id,
  cli_installed: true,
  available: true,
  status: "ok" as const,
  source: "claude_cli" as const,
  windows,
});

test("quota windows use translated durations and fallback names", () => {
  assert.equal(
    windowLabel({ id: "primary", used_percent: 0, window_minutes: 300 }, translate),
    "engineUsage.fiveHours",
  );
  assert.equal(
    windowLabel({ id: "secondary", used_percent: 0, window_minutes: 10080 }, translate),
    "engineUsage.weekly",
  );
  assert.equal(
    windowLabel({ id: "primary", used_percent: 100, window_minutes: 60 }, translate),
    "engineUsage.window:60",
  );
  assert.equal(windowLabel({ id: "primary", used_percent: 5 }, translate), "engineUsage.primary");
  assert.equal(windowLabel({ id: "secondary", used_percent: 5 }, translate), "engineUsage.secondary");
});

test("the collapsed view picks the window closest to its limit", () => {
  const report = {
    checked_at: now.toISOString(),
    engines: [
      engine("claude", [
        { id: "primary", used_percent: 15, window_minutes: 300 },
        { id: "secondary", used_percent: 87, window_minutes: 10080 },
      ]),
      engine("codex", [{ id: "primary", used_percent: 40 }]),
    ],
  };
  const [claude, codex] = quickWindows(report);
  assert.equal(claude?.window.id, "secondary");
  assert.equal(claude?.remaining, 13);
  assert.equal(codex?.remaining, 60);
  assert.equal(tightestWindow([]), undefined);
});

test("a provider with one window still shows that window", () => {
  const report = { checked_at: now.toISOString(), engines: [engine("codex", [{ id: "primary", used_percent: 30 }])] };
  assert.deepEqual(usageLines(report, now, "en", translate), [
    "codex · engineUsage.primary · engineUsage.remaining:70",
  ]);
});

test("hover lists every window with its share left and reset", () => {
  const report = {
    checked_at: now.toISOString(),
    engines: [
      engine("claude", [
        { id: "primary", used_percent: 15, window_minutes: 300, resets_at: "2026-01-05T12:10:00.000Z" },
        { id: "secondary", used_percent: 87, window_minutes: 10080, resets_at: "2026-01-09T12:00:00.000Z" },
      ]),
      { ...engine("opencode", []), available: false, status: "unavailable" as const },
    ],
  };
  const lines = usageLines(report, now, "en", translate);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "claude · engineUsage.fiveHours · engineUsage.remaining:85 · engineUsage.resetsIn:2 h 10 min");
  assert.match(lines[1] ?? "", /^claude · engineUsage\.weekly · engineUsage\.remaining:13 · engineUsage\.resetsOn:/);
});

test("resets read as a countdown within a day and a weekday after", () => {
  assert.equal(resetLabel("2026-01-05T10:20:00.000Z", now, "en", translate), "engineUsage.resetsIn:20 min");
  assert.equal(resetLabel("2026-01-05T13:00:00.000Z", now, "en", translate), "engineUsage.resetsIn:3 h");
  assert.equal(resetLabel("2026-01-05T09:00:00.000Z", now, "en", translate), "engineUsage.resetsIn:1 min");
  assert.match(resetLabel("2026-01-12T09:00:00.000Z", now, "en", translate), /resetsOn:\w+ \d/);
  assert.match(resetLabel("2026-01-09T09:00:00.000Z", now, "en", translate), /resetsOn:Friday /);
});
