import assert from "node:assert/strict";
import { test } from "node:test";
import { noticeTask } from "./noticeTarget.ts";

test("a task notice opens its task: waiting, due, stalled or ready for review", () => {
  assert.equal(noticeTask({ kind: "task", ref: "task_abc" }), "task_abc");
  assert.equal(noticeTask({ kind: "task", ref: "review:task_abc" }), "task_abc");
  assert.equal(noticeTask({ kind: "due", ref: "task_abc" }), "task_abc");
  assert.equal(noticeTask({ kind: "run", ref: "task_abc" }), undefined);
  assert.equal(noticeTask({ kind: "task" }), undefined);
});
