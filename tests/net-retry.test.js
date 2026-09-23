// A delivery retried only when the request provably never reached the server.
// 2026-09-23 08:33: api.telegram.org was unreachable for a minute, the
// morning summary made one attempt and was lost. Retrying anything else
// (a reset or timeout after the request went out) risks sending it twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isConnectFailure, withConnectRetry } from "#core/net/retry.js";

const fetchFailed = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

test("connect-phase failures are recognised through fetch's cause chain", () => {
  assert.ok(isConnectFailure(fetchFailed("UND_ERR_CONNECT_TIMEOUT")));
  assert.ok(isConnectFailure(fetchFailed("ENOTFOUND")));
  const aggregate = Object.assign(new TypeError("fetch failed"), { cause: { errors: [{ code: "ECONNREFUSED" }] } });
  assert.ok(isConnectFailure(aggregate));
  // The request may have landed: never retried.
  assert.ok(!isConnectFailure(fetchFailed("UND_ERR_HEADERS_TIMEOUT")));
  assert.ok(!isConnectFailure(fetchFailed("ECONNRESET")));
  assert.ok(!isConnectFailure(new Error("telegram 400: bad request")));
});

test("a send that could not connect is retried, then succeeds", async () => {
  let calls = 0;
  const out = await withConnectRetry(async () => {
    calls++;
    if (calls < 3) throw fetchFailed("UND_ERR_CONNECT_TIMEOUT");
    return "sent";
  }, { sleepFn: async () => {} });
  assert.equal(out, "sent");
  assert.equal(calls, 3);
});

test("a failure after the request went out is thrown at once, never resent", async () => {
  let calls = 0;
  await assert.rejects(withConnectRetry(async () => { calls++; throw fetchFailed("UND_ERR_HEADERS_TIMEOUT"); }, { sleepFn: async () => {} }));
  assert.equal(calls, 1);
});

test("retries are bounded", async () => {
  let calls = 0;
  await assert.rejects(withConnectRetry(async () => { calls++; throw fetchFailed("ENOTFOUND"); }, { sleepFn: async () => {} }));
  assert.equal(calls, 3, "one try plus two retries");
});
