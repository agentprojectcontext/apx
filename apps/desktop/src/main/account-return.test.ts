import assert from "node:assert/strict";
import { test } from "node:test";
import { accountReturn } from "./account-return.ts";

test("account callbacks accept only the exact app path and bounded code and state", () => {
  assert.deepEqual(accountReturn("apx://account/callback?code=one-use&state=desktop.nonce"), {
    code: "one-use",
    state: "desktop.nonce",
  });
  for (const value of [
    "https://account/callback?code=x&state=y",
    "apx://elsewhere/callback?code=x&state=y",
    "apx://account/other?code=x&state=y",
    "apx://user@account/callback?code=x&state=y",
    "apx://account:123/callback?code=x&state=y",
    "apx://account/callback?code=x&state=y#extra",
    "apx://account/callback?code=x&code=z&state=y",
    "apx://account/callback?code=x&state=y&redirect=https://example.com",
    "apx://account/callback?code=x",
    "apx://account/callback?code=&state=y",
    `apx://account/callback?code=${"x".repeat(2001)}&state=y`,
    "not a url",
  ])
    assert.equal(accountReturn(value), undefined, value);
});
