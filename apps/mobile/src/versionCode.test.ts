import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { versionCode }: { versionCode: (version: unknown) => number } = createRequire(import.meta.url)(
  "../plugins/version-code.js",
);

test("Android version codes sort releases across patch, minor and major boundaries", () => {
  assert.deepEqual(
    ["2.0.0", "2.0.3", "2.0.99", "2.1.0", "2.99.99", "3.0.0"].map(versionCode),
    [20000, 20003, 20099, 20100, 29999, 30000],
  );
  assert.equal(versionCode("2.0.10"), 20010);
  assert.ok(versionCode("2.0.99") < versionCode("2.1.0"));
  assert.ok(versionCode("2.99.99") < versionCode("3.0.0"));
});

test("Android version codes refuse malformed releases and minor or patch overflow", () => {
  for (const version of [
    "2",
    "2.0",
    "v2.0.0",
    "2.0.0-beta",
    "-1.0.0",
    "2.100.0",
    "2.0.100",
    "2.0.1\nextra",
    null,
    undefined,
  ])
    assert.throws(() => versionCode(version), /versionCode:/, String(version));
});
