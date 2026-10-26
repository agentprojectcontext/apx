import assert from "node:assert/strict";
import { test } from "node:test";
import { sharedUsageRequest } from "./engineUsageRequest.ts";

test("toolbar and dropdown share pending reads, but a refresh reads again", async () => {
  let count = 0;
  const gate = Promise.withResolvers<number>();
  const load = sharedUsageRequest(() => {
    count++;
    return count === 1 ? gate.promise : Promise.resolve(42);
  });
  const toolbar = load();
  const dropdown = load();
  assert.equal(toolbar, dropdown);
  assert.equal(count, 1);
  gate.resolve(37);
  assert.deepEqual(await Promise.all([toolbar, dropdown]), [37, 37]);
  assert.equal(await load(), 42);
  assert.equal(count, 2);
});

test("a shared failure is retryable and never cached as a quota", async () => {
  let count = 0;
  const gate = Promise.withResolvers<number>();
  const load = sharedUsageRequest(() => {
    count++;
    return count === 1 ? gate.promise : Promise.resolve(63);
  });
  const first = load();
  const second = load();
  const results = Promise.allSettled([first, second]);
  gate.reject(new Error("unavailable"));
  assert.deepEqual(
    (await results).map((result) => result.status),
    ["rejected", "rejected"],
  );
  assert.equal(await load(), 63);
  assert.equal(count, 2);
});
