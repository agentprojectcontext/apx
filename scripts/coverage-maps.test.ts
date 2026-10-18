import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { missingSourceMaps, snapshotSourceMaps } from "./coverage-maps.ts";
import { coverageReport } from "./test-coverage.ts";

test("saved build mappings still report original execution after another build replaces dist", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-coverage-maps-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-coverage-orphan-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "missing.js.map"), JSON.stringify({ sources: [], mappings: "" }));
  assert.throws(() => snapshotSourceMaps(root), { code: "ENOENT" });
});
