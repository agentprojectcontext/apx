import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTestScript, type Suite, shard } from "./test-shard.ts";

test("a package's test script is read as its steps before node --test, its flags and its globs", () => {
  assert.deepEqual(parseTestScript('node --test --test-concurrency=1 "src/**/*.test.ts"'), {
    before: [],
    flags: ["--test-concurrency=1"],
    globs: ["src/**/*.test.ts"],
  });
  assert.deepEqual(parseTestScript('node scripts/build.mjs && node --test "test/*.test.ts"'), {
    before: ["node scripts/build.mjs"],
    flags: [],
    globs: ["test/*.test.ts"],
  });
  // Anything else runs as it is, whole.
  assert.equal(parseTestScript("npm run test:unit && npm run test:ui"), undefined);
  assert.equal(parseTestScript('node --test "a.test.ts" && node after.mjs'), undefined);
});

test("the parts together run every file once, spread evenly, and whole suites only in the first", () => {
  const core = Array.from({ length: 10 }, (_, i) => `src/c${i}.test.ts`);
  const suites: Suite[] = [
    { dir: "apps/core", before: [], flags: ["--test-concurrency=1"], files: core },
    { dir: "apps/mobile", whole: "npm test" },
    { dir: "packages/ui", before: ["node scripts/build.mjs"], flags: [], files: ["test/a.test.ts", "test/b.test.ts"] },
  ];
  const parts = [1, 2, 3].map((i) => shard(suites, i, 3));
  const ran = parts.flatMap((p) => p.flatMap((s) => ("whole" in s ? [] : s.files.map((f) => `${s.dir}/${f}`))));
  assert.equal(ran.length, 12);
  assert.equal(new Set(ran).size, 12);
  for (const p of parts) {
    const n = p.flatMap((s) => ("whole" in s ? [] : s.files)).length;
    assert.ok(n === 4, `each part runs 4 of the 12 files, not ${n}`);
  }
  assert.deepEqual(
    parts.map((p) => p.some((s) => "whole" in s)),
    [true, false, false],
  );
  // A part keeps each package's flags and its steps before the tests.
  const ui = parts.flatMap((p) => p).find((s) => s.dir === "packages/ui");
  assert.ok(ui && !("whole" in ui) && ui.before[0] === "node scripts/build.mjs");
});
