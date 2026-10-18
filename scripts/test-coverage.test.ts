import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { coverageMarkdown, coverageReport, sandboxPorts } from "./test-coverage.ts";

test("coverage sandboxes use distinct available loopback ports and honor explicit overrides", async () => {
  const ports = await sandboxPorts({});
  assert.deepEqual(Object.keys(ports), ["E2E_PORT", "E2E_CONTROL_PORT", "E2E_WA_PORT"]);
  assert.equal(new Set(Object.values(ports)).size, 3);
  assert.ok(Object.values(ports).every((port) => Number(port) > 0 && Number(port) < 65536));
  assert.deepEqual(await sandboxPorts({ E2E_PORT: "17460", E2E_CONTROL_PORT: "17461", E2E_WA_PORT: "17462" }), {
    E2E_PORT: "17460",
    E2E_CONTROL_PORT: "17461",
    E2E_WA_PORT: "17462",
  });
});

test("coverage includes never-loaded functions and does not invent runtime behavior for interfaces", () => {
  const report = coverageReport(
    "/work",
    [
      {
        file: "apps/core/src/missing.ts",
        text: "export function missing() { return 1; }\nexport const other = () => 2;",
      },
      { file: "packages/protocol/src/types.ts", text: "export interface Thing { read(): string; }" },
    ],
    [],
  );
  assert.deepEqual(report[0], {
    file: "apps/core/src/missing.ts",
    loaded: false,
    functions: [
      { name: "missing", line: 1, covered: false },
      { name: "other", line: 2, covered: false },
    ],
  });
  assert.deepEqual(report[1]?.functions, []);
});

test("coverage unions execution across processes without double-counting functions or counting the module wrapper", () => {
  const file = "apps/core/src/example.ts";
  const url = pathToFileURL(`/work/${file}`).href;
  const fn = (name: string, startOffset: number, count: number) => ({
    functionName: name,
    ranges: [{ startOffset, endOffset: startOffset + 10, count }],
  });
  const report = coverageReport(
    "/work",
    [{ file, text: "\nfunction work() {}\nfunction missing() {}" }],
    [
      { url, functions: [fn("", 0, 1), fn("work", 1, 0), fn("missing", 20, 0)] },
      { url, functions: [fn("work", 1, 3)] },
      { url: "node:fs", functions: [fn("readFile", 1, 99)] },
    ],
  );
  assert.deepEqual(report[0]?.functions, [
    { name: "work", line: 2, covered: true },
    { name: "missing", line: 3, covered: false },
  ]);
  assert.equal(report[0]?.loaded, true);
});

test("coverage markdown shows exact missing function locations and per-area totals", () => {
  const markdown = coverageMarkdown([
    {
      file: "apps/core/src/example.ts",
      loaded: true,
      functions: [
        { name: "read", line: 3, covered: true },
        { name: "write", line: 8, covered: false },
      ],
    },
  ]);
  assert.match(markdown, /\| apps\/core \| 1\/1 \| 1\/2 \|/);
  assert.match(markdown, /L8: write/);
  assert.doesNotMatch(markdown, /L3: read/);
});

test("compiled UI functions map back to their TSX source without counting generated files as missing code", () => {
  const url = pathToFileURL("/work/packages/ui/dist/view.js").href;
  const text = "function View() { return 1; }";
  const report = coverageReport(
    "/work",
    [{ file: "packages/ui/src/View.tsx", text }],
    [{ url, functions: [{ functionName: "View", ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }] }] }],
    [{ url, text, sources: ["../src/View.tsx"], mappings: "AAAA" }],
  );
  assert.deepEqual(report, [
    { file: "packages/ui/src/View.tsx", loaded: true, functions: [{ name: "View", line: 1, covered: true }] },
  ]);
});

test("outer function calls do not count an uninvoked nested callback as covered", () => {
  const text = "function outer() { return () => 1; }";
  const url = pathToFileURL("/work/apps/core/src/example.ts").href;
  const report = coverageReport(
    "/work",
    [{ file: "apps/core/src/example.ts", text }],
    [
      {
        url,
        functions: [
          { functionName: "outer", ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }] },
          {
            functionName: "",
            ranges: [{ startOffset: text.indexOf("() =>"), endOffset: text.indexOf(";"), count: 0 }],
          },
        ],
      },
    ],
  );
  assert.deepEqual(
    report[0]?.functions.map((f) => f.covered),
    [true, false],
  );
});
