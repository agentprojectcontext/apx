import assert from "node:assert/strict";
import { test } from "node:test";
import { windowLabel } from "./engineUsageModel.ts";

const translate = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? `:${vars.minutes}` : ""}`;

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
