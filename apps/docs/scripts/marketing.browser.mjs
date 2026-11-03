import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = process.env.DOCS_TEST_URL ?? "http://127.0.0.1:4488";
const output = process.env.DOCS_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const google = [];
    await context.route(/https:\/\/[^/]*(google-analytics\.com|googletagmanager\.com)\//, async (route) => {
      google.push(route.request().url());
      await route.abort();
    });
    await page.goto(
      `${base}/?email=private%40example.com&utm_source=youtube&utm_medium=video&utm_campaign=launch#private`,
      { waitUntil: "networkidle" },
    );
    await page.locator("[data-cookie-reject]").click();
    const button = page.locator("#download [data-copy]:visible").first();
    await button.scrollIntoViewIfNeeded();
    await button.click();
    assert.equal(google.length, 0);
    assert.equal(await page.evaluate(() => window.dataLayer), undefined);
    await page.locator("[data-cookie-settings]").click();
    await page.locator("[data-cookie-accept]").click();
    const events = () =>
      page.evaluate(() => window.dataLayer.map((args) => Array.from(args)).filter((item) => item[0] === "event"));
    await expect.poll(async () => (await events()).filter((item) => item[1] === "page_view").length).toBe(1);
    await page.evaluate(() => {
      const link = document.querySelector("#download a[data-file]");
      link.href = "https://github.com/agentprojectcontext/apx/releases/download/v2.0.0/apx-mac-x64.dmg?email=private";
      document.addEventListener("click", (event) => event.preventDefault(), { once: true });
      link.click();
    });
    const download = (await events()).find((event) => event[1] === "download_click");
    assert.equal(download[2].os, "macos");
    assert.equal(download[2].architecture, "x64");
    assert.equal(download[2].placement, "downloads");
    await button.click();
    await expect.poll(async () => (await events()).filter((item) => item[1] === "install_copy").length).toBe(1);
    // The actual Home handler must not report or display success on a rejected clipboard write.
    await page.evaluate(() =>
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async () => {
          throw Error("denied");
        },
      }),
    );
    await button.click();
    assert.equal((await events()).filter((item) => item[1] === "install_copy").length, 1);
    const serialized = JSON.stringify(await events());
    assert.ok(!serialized.includes("private"));
    assert.ok(!serialized.includes("install.sh"));
    const config = await page.evaluate(() => Array.from(window.dataLayer.find((item) => item[0] === "config"))[2]);
    assert.equal(config.campaign_source, "youtube");
    assert.equal(config.campaign_medium, "video");
    if (output) await page.screenshot({ path: join(output, `marketing-${width}-home.png`) });
    await page.goto(`${base}/compare/hermes-agent/`, { waitUntil: "networkidle" });
    await page.locator(".crew-card").scrollIntoViewIfNeeded();
    await expect.poll(async () => (await events()).filter((item) => item[1] === "article_complete").length).toBe(1);
    await page.locator(".crew-card").scrollIntoViewIfNeeded();
    assert.equal((await events()).filter((item) => item[1] === "article_complete").length, 1);
    if (output) await page.screenshot({ path: join(output, `marketing-${width}-article.png`) });
    await page.locator("[data-cookie-settings]").click();
    await page.locator("[data-cookie-reject]").click();
    await expect.poll(() => page.evaluate(() => window["ga-disable-G-BZT6ME07J4"])).toBe(true);
    await page.reload({ waitUntil: "networkidle" });
    const before = google.length;
    await page.locator(".crew-card").scrollIntoViewIfNeeded();
    assert.equal(google.length, before);
    assert.equal(await page.evaluate(() => window.dataLayer), undefined);
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${width}px: no pre-consent events, one view, asset/copy/completion, finite UTM, no PII, failed clipboard, withdrawal`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
