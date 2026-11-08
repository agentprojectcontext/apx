import assert from "node:assert/strict";
import { test } from "node:test";
import { previousRelease } from "./release-previous.ts";

const releases = [
  { tag_name: "v2.13.1", draft: false },
  { tag_name: "v2.13.0", draft: true },
  { tag_name: "v2.12.5", draft: false },
  { tag_name: "v2.12.10", draft: false },
  { tag_name: "v1.40.0", draft: false },
];

test("a release whose build failed is skipped, so the next one tells its commits", () => {
  assert.equal(previousRelease("v2.13.1", releases), "v2.12.10");
});

test("the previous release is the newest published v2 before the tag, by version", () => {
  assert.equal(previousRelease("v2.12.10", releases), "v2.12.5");
  assert.equal(previousRelease("v2.12.5", releases), undefined);
});

test("the tag's own release, still a draft while it is announced, does not matter", () => {
  assert.equal(previousRelease("v2.14.0", [...releases, { tag_name: "v2.14.0", draft: true }]), "v2.13.1");
});
