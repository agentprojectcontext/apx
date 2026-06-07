import { test } from "node:test";
import assert from "node:assert/strict";
import { isContextDestroyed, withContextRetry } from "../src/core/tools/browser.js";

test("isContextDestroyed matches the Puppeteer redirect-teardown errors", () => {
  for (const msg of [
    "Execution context was destroyed, most likely because of a navigation.",
    "Error: Execution context was destroyed, most likely because of a navigation.",
    "Cannot find context with specified id",
    "Execution context is not available in detached frame",
    "Protocol error (Runtime.callFunctionOn): Target closed.",
    "Session closed. Most likely the page has been closed.",
    "Navigating frame was detached",
  ]) {
    assert.ok(isContextDestroyed(new Error(msg)), `should match: ${msg}`);
  }
});

test("isContextDestroyed does NOT match unrelated errors", () => {
  for (const msg of [
    "Element not found: #foo",
    "net::ERR_NAME_NOT_RESOLVED",
    "url required",
    "Navigation timeout of 30000 ms exceeded",
  ]) {
    assert.ok(!isContextDestroyed(new Error(msg)), `should NOT match: ${msg}`);
  }
});

test("withContextRetry retries a context-destroyed failure then succeeds", async () => {
  let calls = 0;
  const result = await withContextRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("Execution context was destroyed, most likely because of a navigation.");
      return "ok";
    },
    { retries: 2, delayMs: 1 }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3); // initial + 2 retries
});

test("withContextRetry gives up after the retry budget and rethrows", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withContextRetry(
        async () => {
          calls++;
          throw new Error("Execution context was destroyed");
        },
        { retries: 2, delayMs: 1 }
      ),
    /Execution context was destroyed/
  );
  assert.equal(calls, 3); // initial + 2 retries, then throws
});

test("withContextRetry does NOT retry non-context errors", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withContextRetry(
        async () => {
          calls++;
          throw new Error("Element not found: #foo");
        },
        { retries: 2, delayMs: 1 }
      ),
    /Element not found/
  );
  assert.equal(calls, 1); // thrown immediately, no retries
});
