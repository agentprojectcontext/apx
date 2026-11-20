import assert from "node:assert/strict";
import { test } from "node:test";
import { createProcessExits } from "./process-exits.ts";

test("an MCP process is not closed until the transport reports its exit", async () => {
  const tracker = createProcessExits();
  let originalClosed = false;
  const transport = {
    pid: 42,
    onclose: () => {
      originalClosed = true;
    },
  };
  tracker.watch("global::one", transport)();
  await tracker.wait((key) => key === "global::other");
  let finished = false;
  const wait = tracker
    .wait((key) => key === "global::one")
    .then(() => {
      finished = true;
    });
  await Promise.resolve();
  assert.equal(finished, false);
  transport.onclose();
  await wait;
  assert.equal(originalClosed, true);
  assert.equal(finished, true);
});
