import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import { localBrowserScripts, startPageCoverage } from "../e2e/coverage.ts";

test("browser coverage maps only the sandbox's own assets to their local build output", () => {
  const root = path.resolve("coverage-fixture");
  const functions = [
    { functionName: "send", isBlockCoverage: true, ranges: [{ startOffset: 10, endOffset: 50, count: 1 }] },
  ];
  const entries = [
    "http://127.0.0.1:7460/assets/index-abc.js",
    "http://other.example.com/assets/index-abc.js",
    "http://127.0.0.1:7460/assets/nested/escape.js",
    "http://127.0.0.1:7460/widget.js",
    "__playwright_evaluation_script__",
  ].map((url) => ({ url, functions }));
  assert.deepEqual(localBrowserScripts(root, "http://127.0.0.1:7460", entries), [
    { url: pathToFileURL(path.join(root, "apps/web/dist/assets/index-abc.js")).href, functions },
  ]);
});

test("browser coverage stays inactive unless explicitly requested", async (t) => {
  const previous = process.env.APX_TEST_COVERAGE_DIR;
  delete process.env.APX_TEST_COVERAGE_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.APX_TEST_COVERAGE_DIR;
    else process.env.APX_TEST_COVERAGE_DIR = previous;
  });
  let touched = false;
  const page = new Proxy(
    {},
    {
      get() {
        touched = true;
        throw new Error("coverage must stay off");
      },
    },
  ) as Page;
  await (await startPageCoverage(page))();
  assert.equal(touched, false);
});

test("browser coverage keeps counters across navigation and includes temporary cores without outside scripts", async (t) => {
  const previous = process.env.APX_TEST_COVERAGE_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-browser-coverage-"));
  process.env.APX_TEST_COVERAGE_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.APX_TEST_COVERAGE_DIR;
    else process.env.APX_TEST_COVERAGE_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const page = new EventEmitter();
  let address = "about:blank";
  const frame = { url: () => address };
  const starts: unknown[] = [];
  let stopped = 0;
  const functions = [
    { functionName: "load", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 12, count: 1 }] },
  ];
  const finish = await startPageCoverage(
    Object.assign(page, {
      mainFrame: () => frame,
      isClosed: () => false,
      coverage: {
        async startJSCoverage(options: unknown) {
          starts.push(options);
        },
        async stopJSCoverage() {
          stopped++;
          return ["http://127.0.0.1:7460", "http://127.0.0.1:38921", "https://external.example.com"].map((origin) => ({
            url: `${origin}/assets/index.js`,
            functions,
          }));
        },
      },
    }) as unknown as Page,
  );
  for (const url of ["http://127.0.0.1:7460/", "http://127.0.0.1:38921/", "about:blank"]) {
    address = url;
    page.emit("framenavigated", frame);
  }
  page.emit("framenavigated", { url: () => "https://external.example.com/" });
  await finish();
  assert.deepEqual(starts, [{ resetOnNavigation: false }]);
  assert.equal(stopped, 1);
  assert.equal(page.listenerCount("framenavigated"), 0);
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  const data = JSON.parse(fs.readFileSync(path.join(dir, files[0] ?? ""), "utf8"));
  assert.equal(data.result.length, 2);
  assert.ok(
    data.result.every(
      (entry: { url: string }) => entry.url === pathToFileURL(path.resolve("apps/web/dist/assets/index.js")).href,
    ),
  );
  assert.deepEqual(data.result[0].functions, functions);
});
