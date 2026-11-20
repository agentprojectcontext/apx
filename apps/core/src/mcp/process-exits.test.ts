import assert from "node:assert/strict";
import { test } from "node:test";
import { manualTimers } from "../testkit/platform.ts";
import { createProcessExits } from "./process-exits.ts";

test("an MCP process timeout refuses replacement and retries still wait for its exit", async () => {
  const timers = manualTimers();
  const tracker = createProcessExits(timers);
  const transport = { pid: 42, onclose: () => {} };
  tracker.watch("global::one", transport)();
  const first = tracker.wait(() => true);
  timers.tick(10_000);
  await assert.rejects(first, /did not exit/);
  const retry = tracker.wait(() => true);
  timers.tick(10_000);
  await assert.rejects(retry, /did not exit/);
  transport.onclose();
  await tracker.wait(() => true);
  assert.equal(timers.pending(), 0);
});

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
