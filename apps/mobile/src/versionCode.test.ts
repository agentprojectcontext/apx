import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { versionCode } = createRequire(import.meta.url)("../plugins/version-code.js") as {
  versionCode: (version: string) => number;
};

test("the versionCode follows the version, so every later release installs over the one before", () => {
  assert.equal(versionCode("2.0.10"), 20010);
  assert.equal(versionCode("2.1.0"), 20100);
  assert.ok(versionCode("2.0.99") < versionCode("2.1.0"));
  assert.ok(versionCode("2.99.99") < versionCode("3.0.0"));
});

test("a version it cannot order is refused at build time", () => {
  assert.throws(() => versionCode("2.0"));
  assert.throws(() => versionCode("2.0.1-beta"));
  assert.throws(() => versionCode("2.100.0"));
});
