import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { chromium } from "@playwright/test";
import { tempDir } from "../testkit/platform.ts";
import { createHeadlessBrowser } from "./headless-browser.ts";
import { createWidgetPages, editDocument } from "./widget-pages.ts";
import { mergeStyle } from "./widget-save.ts";

const chrome = chromium.executablePath();
const WIDTH = 480;
const HEIGHT = 240;
// Parts at known places, so a point picks them; the last one is drawn by the widget's code when it runs.
const at = (top: number) => `position:absolute;left:0;top:${top}px;margin:0;height:30px;width:300px`;
const DOC = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sales</title></head><body>
<h1 id="title" style="${at(0)}">
  Weekly sales
</h1>
<p class="total" style="${at(100)}">Total</p>
<script>const b = document.createElement("b"); b.textContent = "Live"; b.style.cssText = "${at(180)}"; document.body.append(b);</script>
</body></html>`;

let dir: ReturnType<typeof tempDir> | undefined;
let browser: ReturnType<typeof createHeadlessBrowser>;
let pages: ReturnType<typeof createWidgetPages>;

before(() => {
  assert.ok(fs.existsSync(chrome), "Install the browser first: pnpm exec playwright install chromium");
  dir = tempDir("apx-widget-save-");
  browser = createHeadlessBrowser({ dir: dir.path, chrome, blockedPorts: () => new Set(), onChange: () => {} });
  pages = createWidgetPages(() => browser.pageCdp());
});
after(async () => {
  await pages?.closeAll();
  browser?.close();
  // Chrome may still hold its profile while it exits; Windows keeps it locked until its last helper is gone.
  await dir?.remove().catch((err: unknown) => {
    if (process.platform !== "win32") throw err;
  });
});

const open = (html: string) =>
  pages.open(editDocument(html, { theme: "", mode: "light", layout: "widget" }), WIDTH, async () => undefined, "srf");
const pickAt = async (page: string, top: number) => {
  const el = await pages.inspect(page, 0.1, (top + 15) / HEIGHT);
  assert.ok(el, `something at ${top}px`);
  return el;
};

test("edits made in edit mode are saved into the widget's own HTML; what its code draws is left for its agent", async () => {
  const page = await open(DOC);
  assert.equal(pages.widgetOf(page), "srf");
  const title = await pickAt(page, 0);
  const total = await pickAt(page, 100);
  const live = await pickAt(page, 180);
  assert.deepEqual([title.tag, total.tag, live.tag], ["h1", "p", "b"]);
  const edits = [
    { node: title.node, text: "Sales <b>this</b> week", style: { color: "#ff0000" } },
    { node: total.node, style: { font_size: 20, padding: 4 } },
    { node: live.node, text: "Changed" },
  ];
  await pages.preview(page, edits);
  const r = await pages.save(page, edits, DOC);
  assert.deepEqual(r.saved, [title.node, total.node]);
  assert.deepEqual(r.missed, [live.node]);
  assert.match(r.html, /^<!doctype html>\n<html lang="en">/);
  // Typed words stay words, with the spaces the HTML had around them.
  assert.match(r.html, /color: #ff0000">\n {2}Sales &lt;b&gt;this&lt;\/b&gt; week\n<\/h1>/);
  assert.match(
    r.html,
    /<p class="total" style="[^"]*height:30px; width:300px; font-size: 20px; padding: 4px">Total<\/p>/,
  );
  // The page's code is kept as it was, and nothing it drew is written into the HTML.
  assert.ok(r.html.includes("document.body.append(b);</script>"));
  assert.doesNotMatch(r.html, /<b[ >]|Changed|!important|__apx|Content-Security-Policy/);
  await pages.close(page);
});

test("a widget written as a fragment is saved as a fragment", async () => {
  const fragment = `<style>p{color:blue}</style><p id="a" style="${at(0)}">One</p>`;
  const page = await open(fragment);
  const one = await pickAt(page, 0);
  const r = await pages.save(page, [{ node: one.node, text: "Uno" }], fragment);
  assert.equal(r.html, `<style>p{color:blue}</style><p id="a" style="${at(0)}">Uno</p>`);
  await pages.close(page);
});

test("a style edit replaces the element's own declaration for that property and keeps the rest", () => {
  assert.equal(
    mergeStyle("color: red; margin: 0;", { color: "#00ff00", font_size: 12 }),
    "margin: 0; color: #00ff00; font-size: 12px",
  );
  assert.equal(mergeStyle(undefined, { background: "#000000" }), "background-color: #000000");
});
