// The skill inspector's per-turn decision must be persisted even when nothing
// crossed the load/hint bar — a reopened thread should still show what was
// SUGGESTED (the "considered" near-misses), so the RAG is visible every round.
// This regressed when the offline `tf` embedder scored everything below the bar:
// inspectorRecord dropped the whole row, and the badges silently stopped showing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectorRecord } from "#host/daemon/api/super-agent.js";

test("inspectorRecord — keeps the row when a skill was loaded", () => {
  const rec = inspectorRecord({ enabled: true, embedder: "tf", loaded: ["postbean-mcp"], hinted: [] });
  assert.ok(rec);
  assert.deepEqual(rec.loaded, ["postbean-mcp"]);
});

test("inspectorRecord — keeps the row on a scored-only (below-threshold) turn", () => {
  const rec = inspectorRecord({
    enabled: true,
    embedder: "tf",
    reason: "below_threshold",
    scored: [{ slug: "postbean-mcp", sim: 0.31 }, { slug: "postiz", sim: 0.22 }],
  });
  assert.ok(rec, "a scored-only turn must still be recorded");
  assert.equal(rec.embedder, "tf");
  assert.equal(rec.scored?.[0]?.slug, "postbean-mcp");
  assert.equal(rec.loaded, undefined);
  assert.equal(rec.hinted, undefined);
});

test("inspectorRecord — null only when the inspector said nothing at all", () => {
  assert.equal(inspectorRecord(null), null);
  assert.equal(inspectorRecord({ enabled: false, reason: "disabled" }), null);
  assert.equal(inspectorRecord({ enabled: true, reason: "prompt_too_short" }), null);
  assert.equal(inspectorRecord({ enabled: true, reason: "no_candidates", scored: [] }), null);
});
