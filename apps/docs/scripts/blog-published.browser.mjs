import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = (process.env.DOCS_TEST_URL ?? "http://127.0.0.1:4426").replace(/\/$/, "");
const output = process.env.DOCS_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const pre of ["", "/es"]) {
      const lang = pre ? "es" : "en";
      await page.goto(`${base}${pre}/blog/`, { waitUntil: "networkidle" });
      if (await page.locator("[data-cookie-reject]").isVisible()) await page.locator("[data-cookie-reject]").click();
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      if (width === 1440) {
        await page.locator(".nav__blog > a").hover();
        await expect(page.locator(".nav__blog .nav__menu")).toBeVisible();
        for (const image of await page.locator(".nav__blog img").all()) {
          assert.ok(await image.evaluate((element) => element.complete && element.naturalWidth > 0));
        }
        if (output) await page.screenshot({ path: join(output, `${width}-${lang}-blog-menu.png`) });
        await page.mouse.move(20, 700);
      } else {
        await page.locator(".nav__toggle").click();
        await expect(page.locator(".nav__blog > a")).toBeVisible();
        await page.keyboard.press("Escape");
      }
      if (output) await page.screenshot({ path: join(output, `${width}-${lang}-archive.png`), fullPage: true });
      const articles = await page.locator(".blog-row").evaluateAll((links) => links.map((link) => link.href));
      assert.ok(articles.length > 0 && articles.length <= 10);
      for (const [index, url] of articles.entries()) {
        await page.goto(url, { waitUntil: "networkidle" });
        await expect(page.locator("main h1")).toHaveCount(1);
        await expect(page.locator(".nav__blog > a")).toHaveAttribute("aria-current", "page");
        await expect(page.locator("[data-home-nav][aria-current]")).toHaveCount(0);
        const cover = page.locator(".blog-hero .blog-cover img");
        await expect(cover).toBeVisible();
        assert.ok(await cover.evaluate((element) => element.complete && element.naturalWidth > 0));
        const header = await page.locator("#nav").boundingBox();
        const back = await page.locator("main > .blog-back").boundingBox();
        const imageBox = await cover.boundingBox();
        const heading = await page.locator("main h1").boundingBox();
        assert.ok(back.y >= header.y + header.height, "Back link must clear the fixed header");
        assert.ok(back.y < 115, "Article should begin near the fixed header");
        assert.ok(imageBox.y < heading.y, "Cover must precede the article title");
        assert.ok(heading.width <= 800, "Reading column remains bounded");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await expect(page.locator(".blog-sources a").first()).toBeVisible();
        const related = page.locator('[aria-labelledby="related"]');
        await expect(related.locator(".blog-row")).toHaveCount(Math.min(3, articles.length - 1));
        const relatedUrls = await related.locator(".blog-row").evaluateAll((links) => links.map((link) => link.href));
        assert.ok(
          relatedUrls.every(
            (relatedUrl) => relatedUrl !== url && new URL(relatedUrl).pathname.startsWith(`${pre}/blog/`),
          ),
        );
        await related.scrollIntoViewIfNeeded();
        if (index === 0 && output) await page.screenshot({ path: join(output, `${width}-${lang}-related.png`) });
        await related.locator(".blog-row").first().click();
        await expect(page).toHaveURL(relatedUrls[0]);
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        await page.goto(url, { waitUntil: "networkidle" });
        if (index === 0 && output)
          await page.screenshot({ path: join(output, `${width}-${lang}-article.png`), fullPage: true });
        if (index === 0) {
          await page.locator("#theme").click();
          await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
          if (output)
            await page.screenshot({ path: join(output, `${width}-${lang}-article-light.png`), fullPage: true });
          await page.locator("#theme").click();
        }
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(
  "Published article layout, images, sources, themes and overflow passed in EN/ES at desktop and phone widths.",
);
