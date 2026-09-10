// Ranking skills by how far each stands above its OWN baseline.
//
// The bug: raw cosine is not comparable across skills. A long, chatty
// description in the language the owner writes in scored ~0.55 against
// anything they typed; a short, precise one in another language topped out
// near 0.43 on its own subject. With one absolute threshold for all of them,
// the loud descriptions won every turn and the matching skill was never named
// — on a live index, "create a task" ranked the task skill LAST.
//
// These tests are about the property that fixes it: the score must depend on
// how unusual a match is FOR THAT SKILL, not on how loud the skill is.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  measureBaseline,
  relevanceScore,
  BASELINE_CORPUS,
  BASELINE_VERSION,
} from "#core/agent/skills/baseline.js";

// Small, exact vectors so every number below is arithmetic, not embedding luck.
const unit = (...xs) => {
  const n = Math.hypot(...xs) || 1;
  return xs.map((x) => x / n);
};

test("a skill sitting close to ordinary language gets a high floor", () => {
  const corpus = [unit(1, 0, 0), unit(0.9, 0.1, 0), unit(0.95, 0, 0.05)];
  const loud = measureBaseline(unit(1, 0, 0), corpus);      // right on top of it
  const quiet = measureBaseline(unit(0, 0, 1), corpus);     // orthogonal to it

  assert.ok(loud.mu > 0.9, `a description near ordinary language floors high (${loud.mu})`);
  assert.ok(quiet.mu < 0.2, `one far from it floors low (${quiet.mu})`);
});

test("the loud skill needs a much better match than the quiet one to score the same", () => {
  const corpus = [unit(1, 0, 0), unit(0.9, 0.1, 0), unit(0.95, 0, 0.05)];
  const loud = measureBaseline(unit(1, 0, 0), corpus);
  const quiet = measureBaseline(unit(0, 0, 1), corpus);

  // This is the whole point. A raw 0.60 is a strong hit for the quiet skill and
  // BELOW normal for the loud one, and only relevance can tell them apart.
  const loudRel = relevanceScore(0.60, { base_mu: loud.mu, base_sd: loud.sd });
  const quietRel = relevanceScore(0.60, { base_mu: quiet.mu, base_sd: quiet.sd });

  assert.ok(quietRel > loudRel, "same cosine, and the quiet skill is the better match");
  assert.ok(loudRel < 0, "0.60 is below the loud skill's own floor, so it is not a match at all");
});

test("relevance is zero when a skill scores exactly its own average", () => {
  const item = { base_mu: 0.5, base_sd: 0.1 };
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  near(relevanceScore(0.5, item), 0);
  near(relevanceScore(0.6, item), 1);   // one spread above
  near(relevanceScore(0.4, item), -1);
});

test("a skill indexed before baselines existed falls back to raw cosine", () => {
  // Degrade to the old behaviour rather than crashing or letting it win: a
  // stale index misranks one skill, it does not take the daemon down.
  assert.equal(relevanceScore(0.42, {}), 0.42);
  assert.ok(Math.abs(relevanceScore(0.42, { base_mu: 0.3 }) - 0.12) < 1e-9);
});

test("a degenerate spread cannot produce an infinite score", () => {
  // sd 0 would make every z Infinity, and an Infinity here is a skill injected
  // into every turn forever.
  const flat = measureBaseline(unit(1, 0, 0), [unit(1, 0, 0), unit(1, 0, 0)]);
  assert.ok(flat.sd > 0, "the spread is floored above zero");
  assert.ok(Number.isFinite(relevanceScore(0.9, { base_mu: flat.mu, base_sd: flat.sd })));
});

test("no baseline measurable → relevance equals the raw score", () => {
  assert.deepEqual(measureBaseline([], []), { mu: 0, sd: 1 });
  assert.deepEqual(measureBaseline(null, [unit(1, 0)]), { mu: 0, sd: 1 });
});

test("the background corpus is bland, balanced and versioned", () => {
  // It measures "how close is this description to ordinary language". A corpus
  // with subjects in it would measure closeness to those subjects instead.
  assert.ok(BASELINE_CORPUS.length >= 8, "enough samples for a stable mean");
  assert.ok(Number.isInteger(BASELINE_VERSION) && BASELINE_VERSION >= 1);

  // Two languages, roughly balanced, so a skill is not credited merely for
  // being written in the one the owner types in — which is exactly what the
  // old raw-cosine ranking rewarded.
  const ascii = BASELINE_CORPUS.filter((s) => /^[\x20-\x7E]+$/.test(s) && / (the|you|and|to|it|I) /.test(` ${s} `));
  assert.ok(ascii.length >= 6, "there is a substantial English half");
  assert.ok(BASELINE_CORPUS.length - ascii.length >= 6, "and a substantial non-English half");
});
