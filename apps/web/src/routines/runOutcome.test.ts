import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoutineRun } from "@apx/protocol";
import { markText, outcomeMarks, toneOf } from "./runOutcome.ts";

const run = (x: Partial<RoutineRun>): RoutineRun => ({
  run_id: "run_1",
  thread_id: "th_1",
  state: "completed",
  started_at: "2026-11-13T12:36:13.452Z",
  ...x,
});
const t = (k: string) => k;

test("a run whose agent answered SKIP is the skip badge, in the colour of a run", () => {
  const marks = outcomeMarks(run({ delivered: false, model_called: true }), "watch");
  assert.deepEqual(
    marks.map((m) => [m.key, Boolean(m.quiet)]),
    [["quiet.label", true]],
  );
  assert.equal(toneOf(run({ delivered: false, model_called: true }), "watch"), "ran");
});

test("a run that did not call the model is only the skip badge; one that told the owner is not quiet", () => {
  const skipped = outcomeMarks(run({ delivered: false, model_called: false }), "watch");
  assert.deepEqual(
    skipped.map((m) => m.key),
    ["quiet.label"],
  );
  assert.equal(toneOf(run({ delivered: false, model_called: false }), "watch"), "skipped");
  const told = outcomeMarks(run({ delivered: true, model_called: true }), "agent");
  assert.ok(told.every((m) => !m.quiet));
  // Canceled is the owner's doing, not "nothing new".
  assert.ok(outcomeMarks(run({ state: "canceled", delivered: false }), "agent").every((m) => !m.quiet));
});

test("a failed run says why in short words, the whole sentence as its detail; an unknown reason says only Failed", () => {
  const [failed] = outcomeMarks(run({ state: "failed", failure: "network" }), "watch");
  assert.equal(failed?.reason, "routineChat.failure.network");
  assert.equal(failed?.detail, "notice.run.failed.network");
  assert.equal(failed && markText(failed, t), "routines.legend.failed · routineChat.failure.network");
  const [other] = outcomeMarks(run({ state: "failed", failure: "other" }), "watch");
  assert.equal(other && markText(other, t), "routines.legend.failed");
});
