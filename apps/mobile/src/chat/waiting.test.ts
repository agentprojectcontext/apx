import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "../protocol";
import { inLine, movedRuns, outOfLine, wordsOf } from "./waiting.ts";

const msg = (id: string, seq: number, waiting?: Message["waiting"]): Message => ({
  id,
  thread_id: "th",
  seq,
  author: { kind: "user" },
  parts: [{ type: "text", text: id }],
  created_at: "2026-11-06T10:00:00Z",
  ...(waiting ? { waiting } : {}),
});

const chat = [
  msg("hello", 1),
  msg("later_b", 5, { until: "turn", run: "run_b" }),
  msg("steer", 3, { until: "step" }),
  msg("later_a", 4, { until: "turn", run: "run_a" }),
];

test("messages in line leave the transcript and run in their order; one sent into the turn stays where it was", () => {
  assert.deepEqual(
    inLine(chat).map((m) => m.id),
    ["later_a", "later_b"],
  );
  assert.deepEqual(
    outOfLine(chat).map((m) => m.id),
    ["hello", "steer"],
  );
  assert.equal(outOfLine([msg("a", 1)]).length, 1);
});

test("moving one in line swaps it with its neighbour; the ends do not move further", () => {
  const line = inLine(chat);
  assert.deepEqual(movedRuns(line, "later_b", -1), ["run_b", "run_a"]);
  assert.equal(movedRuns(line, "later_a", -1), undefined);
  assert.equal(movedRuns(line, "later_b", 1), undefined);
  assert.equal(movedRuns(line, "missing", 1), undefined);
});

test("an edit starts from the message's words", () => {
  assert.equal(
    wordsOf({
      ...msg("x", 1),
      parts: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
    }),
    "one\n\ntwo",
  );
});
