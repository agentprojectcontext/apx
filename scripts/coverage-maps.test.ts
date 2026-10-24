import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { removeDir, tempDir } from "../apps/core/src/testkit/platform.ts";
import { missingSourceMaps, readCoveragePayloads, snapshotSourceMaps } from "./coverage-maps.ts";
import { coverageReport } from "./test-coverage.ts";

test("browser counters keep their temporary bundle mappings after the bundle has been removed", (t) => {
  const root = tempDir("apx-coverage-browser-").path;
  t.after(() => removeDir(root));
  const raw = path.join(root, "raw");
  fs.mkdirSync(raw);
  const text = "function Button() { return 1; }";
  const url = pathToFileURL(path.join(root, "removed-bundle.js")).href;
  const source = pathToFileURL(path.join(root, "packages/ui/src/Button.tsx")).href;
  const functions = [{ functionName: "Button", ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }] }];
  fs.writeFileSync(path.join(raw, "node.json"), JSON.stringify({ result: [{ url: "node:fs", functions: [] }] }));
  fs.writeFileSync(
    path.join(raw, "browser.json"),
    JSON.stringify({
      result: [{ url, functions }],
      sourceMaps: [{ url, text, sources: [source], mappings: "AAAA" }],
    }),
  );
  fs.writeFileSync(path.join(raw, "ignored.txt"), "Not coverage");
  const { scripts, sourceMaps } = readCoveragePayloads(raw);
  assert.equal(scripts.length, 2);
  assert.equal(sourceMaps.length, 1);
  assert.deepEqual(coverageReport(root, [{ file: "packages/ui/src/Button.tsx", text }], scripts, sourceMaps), [
    { file: "packages/ui/src/Button.tsx", loaded: true, functions: [{ name: "Button", line: 1, covered: true }] },
  ]);
});

test("invalid coverage payloads fail instead of silently dropping counters", (t) => {
  const raw = tempDir("apx-coverage-invalid-").path;
  t.after(() => removeDir(raw));
  fs.writeFileSync(path.join(raw, "broken.json"), "{");
  assert.throws(() => readCoveragePayloads(raw), SyntaxError);
});

test("saved build mappings still report original execution after another build replaces dist", (t) => {
  const root = tempDir("apx-coverage-maps-").path;
  t.after(() => removeDir(root));
  const dist = path.join(root, "apps/web/dist/assets");
  fs.mkdirSync(dist, { recursive: true });
  const file = path.join(dist, "view.js");
  const text = "function View() { return 1; }";
  fs.writeFileSync(file, text);
  fs.writeFileSync(`${file}.map`, JSON.stringify({ sources: ["../../src/View.tsx"], mappings: "AAAA" }));
  const maps = snapshotSourceMaps(path.join(root, "apps/web/dist"));
  fs.rmSync(`${file}.map`);
  fs.writeFileSync(file, "function NewView() { return 2; }");
  const url = pathToFileURL(file).href;
  const report = coverageReport(
    root,
    [{ file: "apps/web/src/View.tsx", text }],
    [{ url, functions: [{ functionName: "View", ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }] }] }],
    maps,
  );
  assert.deepEqual(report, [
    { file: "apps/web/src/View.tsx", loaded: true, functions: [{ name: "View", line: 1, covered: true }] },
  ]);
  assert.equal(maps[0]?.text, text);
  assert.deepEqual(missingSourceMaps(root, [url], maps), []);
});

test("missing mappings identify only repository builds, deduplicate and ignore third-party counters", () => {
  const root = path.resolve("work");
  const url = (file: string) => pathToFileURL(path.join(root, file)).href;
  const web = url("apps/web/dist/assets/missing.js");
  assert.deepEqual(
    missingSourceMaps(
      root,
      [
        web,
        web,
        url("apps/desktop/dist/preload.cjs"),
        url("packages/ui/dist/index.js"),
        url("node_modules/react/dist/react.js"),
        url("apps/core/src/main.ts"),
        "node:fs",
        "https://example.com/app.js",
      ],
      [],
    ),
    ["apps/desktop/dist/preload.cjs", "apps/web/dist/assets/missing.js", "packages/ui/dist/index.js"],
  );
});

test("an orphaned source map is rejected rather than paired with different generated text", (t) => {
  const root = tempDir("apx-coverage-orphan-").path;
  t.after(() => removeDir(root));
  fs.writeFileSync(path.join(root, "missing.js.map"), JSON.stringify({ sources: [], mappings: "" }));
  assert.throws(() => snapshotSourceMaps(root), { code: "ENOENT" });
});

test("a browser map cannot silently drop a referenced library build's missing map", () => {
  const root = path.resolve("work");
  const url = pathToFileURL(path.join(root, "apps/web/dist/main.js")).href;
  assert.deepEqual(
    missingSourceMaps(
      root,
      [url],
      [
        {
          url,
          text: "function View() {}",
          sources: ["../../../packages/ui/dist/view.js"],
          mappings: "AAAA",
        },
      ],
    ),
    ["packages/ui/dist/view.js"],
  );
});

test("compiler provenance excludes only a pure runtime, never a mixed, application or unknown chunk", async (t) => {
  const { compilerGeneratedChunks, COVERAGE_CHUNKS_FILE } = await import("./coverage-maps.ts");
  const { localBrowserScripts } = await import("../e2e/coverage.ts");
  const directory = tempDir("apx-coverage-provenance-").path;
  t.after(() => removeDir(directory));
  const manifest = path.join(directory, COVERAGE_CHUNKS_FILE);
  assert.equal(compilerGeneratedChunks(directory).size, 0);
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      "assets/helpers.js": ["\0rolldown/runtime.js"],
      "assets/mixed.js": ["\0rolldown/runtime.js", "/work/apps/web/src/View.tsx"],
      "assets/rolldown-runtime-lookalike.js": ["/work/apps/web/src/View.tsx"],
      "assets/empty.js": [],
      "assets/unknown.js": ["\0future/runtime.js"],
    }),
  );
  const root = path.resolve("work");
  const names = ["helpers.js", "mixed.js", "rolldown-runtime-lookalike.js", "empty.js", "unknown.js"];
  const entries = names.map((name) => ({ url: `http://127.0.0.1:7460/assets/${name}`, functions: [] }));
  const selected = localBrowserScripts(root, "http://127.0.0.1:7460", entries, compilerGeneratedChunks(directory));
  assert.deepEqual(
    selected.map((entry) => path.basename(new URL(entry.url).pathname)),
    names.slice(1),
  );
  assert.deepEqual(
    missingSourceMaps(
      root,
      selected.map((entry) => entry.url),
      [],
    ),
    names
      .slice(1)
      .map((name) => `apps/web/dist/assets/${name}`)
      .sort(),
  );
  fs.writeFileSync(manifest, "not json");
  assert.equal(compilerGeneratedChunks(directory).size, 0);
  assert.equal(
    localBrowserScripts(root, "http://127.0.0.1:7460", entries, compilerGeneratedChunks(directory)).length,
    names.length,
  );
});

test("compiler facades omit only static plumbing while their source-bearing targets still require maps", async (t) => {
  const { compilerGeneratedChunks, COVERAGE_CHUNKS_FILE } = await import("./coverage-maps.ts");
  const { localBrowserScripts } = await import("../e2e/coverage.ts");
  const directory = tempDir("apx-coverage-facade-").path;
  t.after(() => removeDir(directory));
  fs.mkdirSync(path.join(directory, "assets"));
  const fixtures = {
    "facade.js": 'import { View as v } from "./target.js"; export { v as View };',
    "reexport.js": 'export { View } from "./target.js";',
    "target.js": "export function View() { return 1; }",
    "function.js": "export function hidden() {}",
    "class.js": "export class Hidden {}",
    "expression.js": 'import "./target.js"; run();',
    "default.js": "export default () => 1;",
    "constant.js": "export const answer = 1;",
    "invalid.js": "export { ;",
    "dynamic.js": 'import("./target.js");',
    "empty.js": "",
    "unknown.js": 'export { View } from "./target.js";',
  };
  const chunks: Record<string, unknown> = {};
  for (const [name, code] of Object.entries(fixtures)) {
    fs.writeFileSync(path.join(directory, "assets", name), code);
    chunks[`assets/${name}`] = name === "target.js" ? ["/work/apps/web/src/View.tsx"] : [];
  }
  chunks["assets/unknown.js"] = null;
  chunks["assets/missing.js"] = [];
  chunks["../escape.js"] = [];
  fs.writeFileSync(path.join(directory, COVERAGE_CHUNKS_FILE), JSON.stringify(chunks));
  assert.deepEqual([...compilerGeneratedChunks(directory)].sort(), ["assets/facade.js", "assets/reexport.js"]);
  const root = path.resolve("work");
  const entries = ["facade.js", "target.js"].map((name) => ({
    url: `http://127.0.0.1:7460/assets/${name}`,
    functions: [],
  }));
  const selected = localBrowserScripts(root, "http://127.0.0.1:7460", entries, compilerGeneratedChunks(directory));
  assert.equal(selected.length, 1);
  const target = pathToFileURL(path.join(root, "apps/web/dist/assets/target.js")).href;
  assert.equal(selected[0]?.url, target);
  assert.deepEqual(
    missingSourceMaps(
      root,
      selected.map((entry) => entry.url),
      [],
    ),
    ["apps/web/dist/assets/target.js"],
  );
  assert.deepEqual(
    missingSourceMaps(
      root,
      selected.map((entry) => entry.url),
      [
        {
          url: target,
          text: fixtures["target.js"],
          sources: ["../../src/View.tsx"],
          mappings: "AAAA",
        },
      ],
    ),
    [],
  );
});
