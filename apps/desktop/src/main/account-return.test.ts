import assert from "node:assert/strict";
import { test } from "node:test";
import { accountReturn } from "./account-return.ts";

test("account wake-ups accept only the exact app path without credentials or parameters", () => {
  assert.equal(accountReturn("apx://account/signed-in"), true);
  for (const value of [
    "https://account/signed-in",
    "apx://elsewhere/signed-in",
    "apx://account/other",
    "apx://user@account/signed-in",
    "apx://account:123/signed-in",
    "apx://account/signed-in#extra",
    "apx://account/signed-in?code=x&state=y",
    "apx://account/callback?code=x&state=y",
    "not a url",
  ])
    assert.equal(accountReturn(value), undefined, value);
});
