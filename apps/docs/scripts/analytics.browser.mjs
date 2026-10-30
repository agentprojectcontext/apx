import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = process.env.DOCS_TEST_URL ?? "http://127.0.0.1:4321";
const output = process.env.DOCS_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) {
    for (const path of [
      "/",
      "/es/",
      "/docs/reference/website-privacy/",
      "/es/docs/reference/website-privacy/",
      "/compare/",
      "/es/compare/",
      "/compare/hermes-agent/",
      "/es/compare/openbot/",
    ]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const google = [];
      await context.route(/https:\/\/[^/]*(google-analytics\.com|googletagmanager\.com)\//, async (route) => {
        google.push(route.request().url());
        await route.abort();
      });
      await page.goto(`${base}${path}?email=private%40example.com#private`, { waitUntil: "networkidle" });
      const panel = page.locator("[data-cookie-panel]");
      await expect(panel).toBeVisible();
      assert.equal(google.length, 0, "no Google request before consent");
      assert.equal(
        await context.cookies().then((cookies) => cookies.filter((cookie) => cookie.name.startsWith("_ga")).length),
        0,
      );
      const bounds = await panel.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
      const name = `${width}-${path.replaceAll("/", "-") || "home"}`;
      if (output) await page.screenshot({ path: join(output, `${name}-initial.png`) });
      await page.locator("[data-cookie-reject]").click();
      await expect(panel).toBeHidden();
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(google.length, 0, "decline persists without Google requests");
      await page.locator("[data-cookie-settings]").click();
      await expect(page.locator("[data-cookie-reject]")).toBeFocused();
      if (output) await page.screenshot({ path: join(output, `${name}-preferences.png`) });
      await page.locator("[data-cookie-accept]").click();
      await expect.poll(() => google.length).toBe(1);
      assert.ok(google[0].endsWith("G-BZT6ME07J4"));
      const commands = await page.evaluate(() => window.dataLayer.map((args) => Array.from(args)));
      const event = commands.find((command) => command[0] === "event");
      assert.equal(event[2].page_location, `${base}${path}`);
      assert.equal(event[2].page_referrer, "");
      assert.equal(event[2].page_title, "APX website");
      // An open second tab observes withdrawal through the browser's real storage event.
      const second = await context.newPage();
      await second.goto(`${base}/es/`, { waitUntil: "networkidle" });
      await expect(second.locator("[data-cookie-panel]")).toBeHidden();
      const beforeRevoke = google.length;
      await page.locator("[data-cookie-settings]").click();
      await page.locator("[data-cookie-reject]").click();
      await expect.poll(() => page.evaluate(() => window["ga-disable-G-BZT6ME07J4"])).toBe(true);
      await expect.poll(() => second.evaluate(() => window["ga-disable-G-BZT6ME07J4"])).toBe(true);
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(google.length, beforeRevoke, "no Google reload after withdrawal");
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${width}px ${path}: initial, decline, preferences, accept, sanitized event, cross-tab withdrawal`,
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
}
