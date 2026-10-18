import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before } from "node:test";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

let browser: Browser;
let directory: string;
let script: string;
let css: string;
let bundle: string;
const coverage = process.env.APX_UI_TEST_COVERAGE_DIR;

before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "apx-ui-test-"));
  bundle = path.join(directory, "fixture.js");
  await build({
    entryPoints: [path.join(import.meta.dirname, "interaction.test-support.ts")],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "browser",
    sourcemap: true,
  });
  script = fs.readFileSync(bundle, "utf8");
  css = fs.readFileSync(path.join(import.meta.dirname, "../dist/styles.css"), "utf8");
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

export async function mounted(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("http://ui.test/**", (route) => {
    const file = new URL(route.request().url()).pathname;
    return route.fulfill(
      file === "/fixture.js"
        ? { contentType: "text/javascript", body: script }
        : {
            contentType: "text/html",
            body: `<html><head><style>${css}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`,
          },
    );
  });
  if (coverage) await page.coverage.startJSCoverage();
  try {
    await page.goto("http://ui.test/");
    await expect(page.getByRole("textbox", { name: "Tags", exact: true })).toBeVisible();
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    try {
      if (coverage) {
        const entries = await page.coverage.stopJSCoverage();
        fs.mkdirSync(coverage, { recursive: true });
        const map = JSON.parse(fs.readFileSync(`${bundle}.map`, "utf8"));
        fs.writeFileSync(
          path.join(coverage, `ui-${randomUUID()}.json`),
          JSON.stringify({
            result: entries
              .filter((entry) => entry.url === "http://ui.test/fixture.js")
              .map((entry) => ({ ...entry, url: pathToFileURL(bundle).href })),
            sourceMaps: [{ ...map, url: pathToFileURL(bundle).href, text: script }],
          }),
        );
      }
    } finally {
      await page.close();
    }
  }
}
