import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseBefore } from "./release.ts";

test("a core's release is behind the panel's only when both are releases and it is lower", () => {
  assert.equal(releaseBefore("2.3.16", "2.3.18"), true);
  assert.equal(releaseBefore("2.3.9", "2.3.18"), true);
  assert.equal(releaseBefore("2.2.40", "2.3.0"), true);
  assert.equal(releaseBefore("2.3.18", "2.3.18"), false);
  assert.equal(releaseBefore("2.3.19", "2.3.18"), false);
  // A checkout's own build is never called out of date.
  assert.equal(releaseBefore("0.0.0", "2.3.18"), false);
  assert.equal(releaseBefore("0.0.0", "2.3.18-dev.4+57b61545"), false);
  assert.equal(releaseBefore("2.3.16", "2.3.18-dev.4+57b61545"), false);
});
