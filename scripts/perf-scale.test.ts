import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { budgetAt, timeScale } from "./perf-scale.ts";

const budget = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "perf-budget.json"), "utf8")) as Record<
  string,
  number
>;

test("unset, the budgets are CI's own", () => {
  assert.equal(timeScale(undefined), 1);
  assert.equal(timeScale(""), 1);
  assert.deepEqual(budgetAt(budget, timeScale(undefined)), budget);
});

test("a slower machine stretches only the time budgets", () => {
  const scaled = budgetAt(budget, timeScale("1.5"));
  for (const k of ["turn_p95_ms", "rpc_p95_ms", "startup_ms"]) {
    const before = budget[k];
    assert.ok(before !== undefined, k);
    assert.equal(scaled[k], before * 1.5, k);
  }
  for (const k of ["idle_rss_mb", "idle_cpu_pct", "rss_after_turns_mb", "initial_bundle_gzip_kb", "boot_gzip_kb"])
    assert.equal(scaled[k], budget[k], k);
});

test("a scale that would tighten the gate or is not a number is refused", () => {
  for (const bad of ["0.5", "0", "-1", "fast", "NaN", "Infinity"])
    assert.throws(() => timeScale(bad), /at least 1/, bad);
});
