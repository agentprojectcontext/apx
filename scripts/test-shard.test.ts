import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { removeDir, tempDir } from "../apps/core/src/testkit/platform.ts";
import { parseTestScript, reportFlaky, rerunVerdict, runFiles, type Suite, shard } from "./test-shard.ts";

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

test("a failed file runs once more: passing then is flaky, failing again fails, and a crash is never flaky", (t) => {
  const dir = tempDir("apx-shard-test-").path;
  t.after(() => removeDir(dir));
  const write = (name: string, body: string) =>
    fs.writeFileSync(path.join(dir, name), `import { test } from "node:test";\nimport fs from "node:fs";\n${body}\n`);
  write("pass.test.ts", 'test("passes", () => {});');
  write("fail.test.ts", 'test("fails", () => { throw new Error("always"); });');
  // Fails the first time only: the marker it leaves makes the second run pass.
  write(
    "flaky.test.ts",
    'test("flaky", () => { const m = "flaky.marker"; if (!fs.existsSync(m)) { fs.writeFileSync(m, ""); throw new Error("first"); } });',
  );
  const files = ["fail.test.ts", "flaky.test.ts", "pass.test.ts"];
  const first = runFiles(dir, [], files, "ignore");
  assert.deepEqual(first, { failed: ["fail.test.ts", "flaky.test.ts"], attributed: true });
  const again = runFiles(dir, [], first.failed, "ignore");
  assert.deepEqual(rerunVerdict(first.failed, again.failed), { flaky: ["flaky.test.ts"], failed: ["fail.test.ts"] });
  assert.deepEqual(runFiles(dir, [], ["pass.test.ts"], "ignore"), { failed: [], attributed: true });
  // The runner refusing to start reports no test: every file failed, none attributed (so none can be called flaky).
  assert.deepEqual(runFiles(dir, ["--no-such-flag"], ["pass.test.ts"], "ignore"), {
    failed: ["pass.test.ts"],
    attributed: false,
  });
});

test("flaky files are written to the job summary, one row each, with their count", (t) => {
  const dir = tempDir("apx-shard-summary-").path;
  t.after(() => removeDir(dir));
  const summary = path.join(dir, "summary.md");
  const log = t.mock.method(console, "log", () => {});
  reportFlaky([], "1/4", summary);
  assert.equal(fs.existsSync(summary), false);
  reportFlaky(["apps/core/src/a.test.ts", "apps/core/src/b.test.ts"], "2/4", summary);
  const text = fs.readFileSync(summary, "utf8");
  assert.match(text, /Flaky: 2 file\(s\)/);
  assert.match(text, /\| `apps\/core\/src\/a\.test\.ts` \| \w+ \| 2\/4 \|/);
  // One annotation per file, which GitHub lists on the run.
  assert.equal(log.mock.calls.filter((c) => String(c.arguments[0]).startsWith("::warning file=")).length, 2);
});
