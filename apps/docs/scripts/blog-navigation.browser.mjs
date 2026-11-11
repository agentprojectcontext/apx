import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const base = (process.env.DOCS_TEST_URL ?? "http://127.0.0.1:4426").replace(/\/$/, "");
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    for (const pre of ["", "/es"]) {
      await page.goto(`${base}${pre}/blog/`);
      await expect(page.locator('.nav__links a[aria-current="page"]')).toHaveText("Blog");
      await expect(page.locator("[data-home-nav][aria-current]")).toHaveCount(0);
      if (width === 1440) {
        await page.locator(".nav__blog > a").focus();
        await expect(page.locator(".nav__blog .nav__menu")).toBeVisible();
        const recent = page.locator(".nav__blog .nav__feat");
        if (await recent.count()) {
          const destination = await recent.getAttribute("href");
          await recent.click();
          await expect(page).toHaveURL(`${new URL(base).origin}${destination}`);
          await page.goto(`${base}${pre}/blog/`);
        }
        await page.locator(".nav__blog > a").focus();
        await page.locator(".nav__blog .nav__menu-foot a").click();
        await expect(page).toHaveURL(`${base}${pre}/blog/`);
      }
      const article = page.locator(".blog-row").first();
      if (await article.count()) {
        await article.click();
        await expect(page.locator('.nav__links a[aria-current="page"]')).toHaveText("Blog");
        await expect(page.locator("[data-home-nav][aria-current]")).toHaveCount(0);
      }
      for (const section of ["questions", "what", "download"]) {
        await page.goto(`${base}${pre}/#${section}`);
        const target = section === "questions" ? "questions" : "product";
        await expect(page.locator(`[data-home-nav="${target}"]`)).toHaveAttribute("aria-current", "location");
        await expect(page.locator("[data-home-nav][aria-current]")).toHaveCount(1);
      }
      await page.goto(`${base}${pre}/`);
      await page.evaluate(() => {
        location.hash = "questions";
      });
      await expect(page.locator('[data-home-nav="questions"]')).toHaveAttribute("aria-current", "location");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("Header active states passed in EN/ES at desktop and phone widths.");
