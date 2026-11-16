import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPrep, prepareShown } from "./prepareBar.ts";

test("the voice's loading bar moves between reports and counts the time left down", () => {
  const prep = { progress: 0.2, left: 20, at: 1000 };
  assert.deepEqual(prepareShown(prep, 1000), { shown: 0.2, left: 20 });
  const later = prepareShown(prep, 11_000);
  assert.ok(later.shown > 0.2 && later.shown < 1);
  assert.equal(later.left, 10);
});

test("a load slower than last time stops short of full and says nothing is left", () => {
  const late = prepareShown({ progress: 0.5, left: 10, at: 0 }, 60_000);
  assert.ok(late.shown < 1);
  assert.equal(late.left, 0);
});

test("the bar never goes back when the voice, once started, reports its own load from zero", () => {
  const core = nextPrep(undefined, { progress: 0, left: 12 }, 0);
  const engine = nextPrep(core, { progress: 0, left: 9 }, 3000);
  assert.ok(engine.progress > 0, "it keeps the ground the wait for the start already covered");
  assert.equal(engine.left, 9);
  assert.equal(nextPrep(engine, { progress: 0.8, left: 2 }, 4000).progress, 0.8);
});
