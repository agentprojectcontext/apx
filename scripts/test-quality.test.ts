import assert from "node:assert/strict";
import { test } from "node:test";
import { scanTestSource } from "./test-quality.ts";

const reasons = (source: string) => scanTestSource("sample.test.ts", source).map((f) => f.reason);

test("test lint rejects disabled and exclusive tests including aliases, computed access and options", () => {
  for (const source of [
    'test.skip("case", () => assert.equal(actual(), 1));',
    'test["only"]("case", () => assert.equal(actual(), 1));',
    'test.describe.fixme("case", () => check());',
    'import { test as check } from "node:test"; check.todo("case");',
    'import check from "node:test"; check.skip("case", () => run());',
    'import * as checks from "node:test"; checks.test.only("case", () => run());',
    'test("case", { skip: !browser }, () => run());',
    'test("case", { only: true }, () => run());',
    'test("case", { todo }, () => run());',
    'test("case", (context) => { context.skip("not today"); });',
  ])
    assert.ok(
      reasons(source).some((r) => r.includes("disabled or exclusive")),
      source,
    );
});

test("test lint ignores labels, fixtures, comments and explicitly false options", () => {
  assert.deepEqual(
    reasons(`
    const labels = { skip: "Skip" };
    const fixture = 'test.skip("example")';
    // test.only("example")
    test("case", { skip: false, only: false }, () => assert.equal(actual(), 1));
  `),
    [],
  );
  assert.deepEqual(
    reasons('const schema = z.string().describe("label"); const regex = new RegExp("x"); regex.test("x");'),
    [],
  );
});

test("test lint rejects empty callbacks, missing implementations and literal-only assertions", () => {
  assert.deepEqual(reasons('test("empty", () => {});'), ["empty test callback"]);
  assert.deepEqual(reasons('test("pending");'), ["test has no implementation"]);
  assert.deepEqual(reasons('test("weak", () => assert.equal(1, 1));'), [
    "assertion only compares literals; it exercises no behavior",
  ]);
  for (const expression of ["expect(true).toBe(true)", "expect(null).toBeNull()", "assert(true)"])
    assert.deepEqual(reasons(`test("weak", () => ${expression});`), [
      "assertion only compares literals; it exercises no behavior",
    ]);
  assert.deepEqual(reasons('test("valid", () => expect(work()).toBe(true));'), []);
});

test("async assertions must be observed, while awaited and returned assertions are valid", () => {
  assert.deepEqual(reasons('test("racy", () => { assert.rejects(work()); });'), [
    "async assertion must be awaited or returned",
  ]);
  assert.deepEqual(reasons('test("racy", () => { void assert.rejects(work()); });'), [
    "async assertion must be awaited or returned",
  ]);
  assert.deepEqual(reasons('import a from "node:assert/strict"; test("racy", () => { a.doesNotReject(work()); });'), [
    "async assertion must be awaited or returned",
  ]);
  assert.deepEqual(
    reasons(
      'test("valid", async () => { await assert.rejects(work()); }); test("returned", () => assert.rejects(work()));',
    ),
    [],
  );
});

test("test lint reports exact source lines for actionable diagnostics", () => {
  assert.deepEqual(scanTestSource("sample.spec.ts", '\n\ntest.skip("case", () => run());'), [
    { file: "sample.spec.ts", line: 3, reason: "disabled or exclusive test: skip" },
  ]);
});
