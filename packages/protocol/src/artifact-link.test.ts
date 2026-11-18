import assert from "node:assert/strict";
import { test } from "node:test";
import { publicArtifactLink } from "./artifact-link.ts";

test("native artifact links accept only an exact public code, never URLs, credentials or destinations", () => {
  assert.equal(publicArtifactLink("apx://artifact/0123abcd"), "0123abcd");
  for (const value of [
    "https://artifact/0123abcd",
    "apx://artifact/0123abcd?url=https://example.com",
    "apx://artifact/0123abcd#x",
    "apx://user@artifact/0123abcd",
    "apx://artifact:80/0123abcd",
    "apx://artifact/0123abcd/",
    "apx://artifact/0123abci",
    "apx://artifact/%30%31%32%33abcd",
    "apx://account/callback?code=0123abcd",
  ]) {
    assert.equal(publicArtifactLink(value), undefined, value);
  }
});
