import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { sourceMapResolver } from "./coverage-source-map.ts";
import { coverageMarkdown, coveragePart, coverageReport, mergeCoverage, sandboxPorts } from "./test-coverage.ts";

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

test("native Babel counters map exact declarations and keep uninvoked nested callbacks uncovered", () => {
  const file = "apps/mobile/src/hooks/example.ts";
  const text = "export function outer() { return () => 1; }\nexport const unused = () => 2;";
  const report = coverageReport(
    "/work",
    [{ file, text }],
    [],
    [],
    [
      {
        path: `/work/${file}`,
        fnMap: {
          "0": { decl: { start: { line: 1, column: text.indexOf("outer") } } },
          "1": { decl: { start: { line: 1, column: text.indexOf("() =>") } } },
          "2": { decl: { start: { line: 2, column: 22 } } },
        },
        f: { "0": 3, "1": 0, "2": 0 },
        s: { "0": 3 },
      },
    ],
  );
  assert.equal(report[0]?.loaded, true);
  assert.deepEqual(
    report[0]?.functions.map((fn) => [fn.name, fn.covered]),
    [
      ["outer", true],
      ["(anonymous)", false],
      ["unused", false],
    ],
  );
});

test("native collection of an untouched TSX module does not count it as loaded or its functions as called", () => {
  const file = "apps/mobile/src/View.tsx";
  const report = coverageReport(
    "/work",
    [{ file, text: "export function View() { return <View />; }" }],
    [],
    [],
    [
      {
        path: `/work/${file}`,
        fnMap: { "0": { decl: { start: { line: 1, column: 0 } } } },
        f: { "0": 0 },
        s: { "0": 0 },
      },
    ],
  );
  assert.deepEqual(report, [{ file, loaded: false, functions: [{ name: "View", line: 1, covered: false }] }]);
});

test("browser counters follow chained UI build maps to the original TSX and preserve uncalled callbacks", () => {
  const root = "/work";
  const browser = pathToFileURL(`${root}/apps/web/dist/view.js`).href;
  const library = pathToFileURL(`${root}/packages/ui/dist/view.js`).href;
  const source = "function View() { return () => 1; }";
  const nested = source.indexOf("() =>");
  // Generated column 24 maps to the same source column (VLQ delta 24 = wB).
  const mappings = "AAAA,wBAAwB";
  const report = coverageReport(
    root,
    [{ file: "packages/ui/src/View.tsx", text: source }],
    [
      {
        url: browser,
        functions: [
          { functionName: "View", ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
          { functionName: "", ranges: [{ startOffset: nested, endOffset: source.length - 2, count: 0 }] },
        ],
      },
    ],
    [
      { url: browser, text: source, sources: ["../../../packages/ui/dist/view.js"], mappings },
      { url: library, text: source, sources: ["../src/View.tsx"], mappings },
    ],
  );
  assert.deepEqual(report, [
    {
      file: "packages/ui/src/View.tsx",
      loaded: true,
      functions: [
        { name: "View", line: 1, covered: true },
        { name: "(anonymous)", line: 1, covered: false },
      ],
    },
  ]);
});

test("chained mapping honors source roots and a position between mapping tokens", () => {
  const root = "/work";
  const text = "function View() { return () => 1; }";
  const browser = pathToFileURL(`${root}/apps/web/dist/view.js`).href;
  const library = pathToFileURL(`${root}/packages/ui/dist/view.js`).href;
  const resolve = sourceMapResolver(
    root,
    [{ file: "packages/ui/src/View.tsx", text }],
    [
      { url: browser, text, sources: ["../../../packages/ui/dist/view.js"], mappings: "AAAA,yBAAyB" },
      { url: library, text, sources: ["View.tsx"], sourceRoot: "../src", mappings: "AAAA,wBAAwB" },
    ],
  );
  assert.deepEqual(resolve(browser, 25, text.length), { file: "packages/ui/src/View.tsx", offset: 24 });
});

test("cycles and missing intermediate maps cannot invent execution in an original module", () => {
  const first = pathToFileURL("/work/apps/web/dist/first.js").href;
  const second = pathToFileURL("/work/apps/web/dist/second.js").href;
  const resolve = sourceMapResolver(
    "/work",
    [],
    [
      { url: first, text: "function first() {}", sources: ["./second.js"], mappings: "AAAA" },
      { url: second, text: "function second() {}", sources: ["./first.js"], mappings: "AAAA" },
    ],
  );
  assert.equal(resolve(first, 0, 18), undefined);
  assert.equal(resolve(pathToFileURL("/work/missing.js").href, 0, 18), undefined);
});

test("a CI part runs only its suites: the panel's in a Playwright shard; with no part, all that the flags ask for", () => {
  assert.deepEqual(coveragePart(["--e2e"]), { unit: true, web: true, desktop: true });
  assert.deepEqual(coveragePart([]), { unit: true, web: false, desktop: false });
  assert.deepEqual(coveragePart(["--e2e", "--part=web", "--shard=2/3"]), {
    name: "web-2-of-3",
    unit: false,
    web: "2/3",
    desktop: false,
  });
  assert.deepEqual(coveragePart(["--e2e", "--part=desktop"]), {
    name: "desktop",
    unit: false,
    web: false,
    desktop: true,
  });
  assert.throws(() => coveragePart(["--part=mobile"]), /unit, web or desktop/);
});

test("parts' reports merge into one: a function ran if any part ran it, a file loaded if any part loaded it", () => {
  const fn = (name: string, line: number, covered: boolean) => ({ name, line, covered });
  const unit = [
    { file: "apps/core/src/a.ts", loaded: true, functions: [fn("start", 1, true), fn("stop", 9, false)] },
    { file: "apps/web/src/b.tsx", loaded: false, functions: [fn("View", 3, false)] },
  ];
  const panel = [
    { file: "apps/core/src/a.ts", loaded: true, functions: [fn("start", 1, false), fn("stop", 9, true)] },
    { file: "apps/web/src/b.tsx", loaded: true, functions: [fn("View", 3, true)] },
  ];
  assert.deepEqual(mergeCoverage([unit, panel]), [
    { file: "apps/core/src/a.ts", loaded: true, functions: [fn("start", 1, true), fn("stop", 9, true)] },
    { file: "apps/web/src/b.tsx", loaded: true, functions: [fn("View", 3, true)] },
  ]);
  // The parts' own reports stay as they were.
  assert.equal(unit[0]?.functions[1]?.covered, false);
});
