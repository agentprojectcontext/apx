import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const base = (process.env.DOCS_TEST_URL ?? "http://127.0.0.1:4426").replace(/\/$/, "");
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    for (const pre of ["", "/es"]) {
      await page.goto(`${base}${pre}/blog/`);
      await expect(page.locator(".blog-row")).toHaveCount(10);
      const first = await page.locator(".blog-row").evaluateAll((links) => links.map((link) => link.href));
      await page.locator('.blog-pagination [rel="next"]').click();
      await expect(page).toHaveURL(`${base}${pre}/blog/page/2/`);
      const second = await page.locator(".blog-row").evaluateAll((links) => links.map((link) => link.href));
      assert.ok(second.length > 0 && second.length <= 10);
      assert.ok(second.every((link) => !first.includes(link)));
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${pre}/blog/page/2/$`));
      await expect(page).toHaveTitle(pre ? /Página 2/ : /Page 2/);
      for (const [lang, prefix] of [
        ["en", ""],
        ["es", "/es"],
      ]) {
        await expect(page.locator(`link[hreflang="${lang}"]`)).toHaveAttribute(
          "href",
          new RegExp(`${prefix}/blog/page/2/$`),
        );
      }
      await page
        .locator(".lang a")
        .filter({ hasText: pre ? "EN" : "ES" })
        .click();
      await expect(page).toHaveURL(`${base}${pre ? "" : "/es"}/blog/page/2/`);
      await page.goBack();
      await page.reload();
      await expect(page.locator(".blog-row")).toHaveCount(second.length);
      await page.locator('.blog-pagination [rel="prev"]').click();
      await expect(page).toHaveURL(`${base}${pre}/blog/`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const sitemap = await (await page.request.get(`${base}/sitemap-0.xml`)).text();
      assert.ok(sitemap.includes(`${pre}/blog/page/2/`));
      assert.equal((await page.request.get(`${base}${pre}/blog/page/999/`)).status(), 404);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("Paginated archive navigation, reload, translations, canonical URLs and sitemap passed.");
