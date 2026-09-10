// Curated notes get reserved slots; they do not have to out-score chat.
//
// The bug: the memory index is ~460 notes the owner deliberately wrote down
// against ~11,600 raw conversation chunks. Ranked in one pool by cosine alone,
// the notes lost to chat fragments sitting closer to the centre of ordinary
// language — and lost by nothing. Asked where the ROMs live, the top hit was a
// chat line about a browser at 0.764 and the note that answers it sat at 0.762.
// A thousandth of a point, eleven thousand times over.
//
// Measured against the live index, reserving slots took retrieval from 5/8 to
// 7/8 with no query getting worse.
import { test } from "node:test";
import assert from "node:assert/strict";

import { reserveForNotes } from "#core/memory/broker.js";

const note = (score, text = "note") => ({ source: "memory", score, text });
const chat = (score, text = "chat") => ({ source: "message", score, text });

test("a note just below several chat hits still makes the block", () => {
  // The real shape of the failure: chat wins on raw score, by a hair.
  const passing = [
    chat(0.764), chat(0.760), chat(0.758), chat(0.756), chat(0.754),
    note(0.762, "the answer"),
  ];
  const kept = reserveForNotes(passing, 5);
  assert.ok(kept.some((r) => r.text === "the answer"), "the note is in");
  assert.equal(kept.length, 5);
});

test("the quota is a floor, not a cap — chat takes every slot when there are no notes", () => {
  const passing = [chat(0.9), chat(0.8), chat(0.7), chat(0.6), chat(0.5), chat(0.4)];
  const kept = reserveForNotes(passing, 5);
  assert.equal(kept.length, 5);
  assert.ok(kept.every((r) => r.source === "message"));
});

test("notes never take MORE than their share", () => {
  // Five notes and five chat rows: chat must keep the slots the quota leaves.
  const passing = [
    note(0.9), note(0.89), note(0.88), note(0.87), note(0.86),
    chat(0.5), chat(0.4),
  ];
  const kept = reserveForNotes(passing, 5);
  assert.equal(kept.filter((r) => r.source === "memory").length, 3, "three of five");
  assert.equal(kept.filter((r) => r.source === "message").length, 2);
});

test("project and agent notes count as notes too", () => {
  const passing = [
    chat(0.9), chat(0.89), chat(0.88), chat(0.87), chat(0.86),
    { source: "project-memory", score: 0.5, text: "proj" },
    { source: "agent-memory", score: 0.4, text: "agent" },
  ];
  const kept = reserveForNotes(passing, 5);
  assert.ok(kept.some((r) => r.text === "proj"));
  assert.ok(kept.some((r) => r.text === "agent"));
});

test("the result stays in score order, so the best hit still reads first", () => {
  const passing = [chat(0.9), note(0.8), chat(0.7), note(0.6)];
  const kept = reserveForNotes(passing, 5);
  const scores = kept.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test("an empty result set stays empty rather than inventing a bullet", () => {
  assert.deepEqual(reserveForNotes([], 5), []);
});

test("topK is respected even when it is smaller than the quota", () => {
  const passing = [note(0.9), note(0.8), note(0.7), chat(0.6)];
  const kept = reserveForNotes(passing, 2);
  assert.equal(kept.length, 2, "never more than asked for");
});
