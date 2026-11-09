import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = (process.env.DOCS_TEST_URL ?? "http://127.0.0.1:4426").replace(/\/$/, "");
const output = process.env.DOCS_TEST_OUTPUT;
const slug = process.env.DOCS_TEST_ARTICLE_SLUG;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const lang of ["en", "es"]) {
      const pre = lang === "es" ? "/es" : "";
      await page.goto(`${base}${pre}/blog/`, { waitUntil: "networkidle" });
      if (await page.locator("[data-cookie-reject]").isVisible()) await page.locator("[data-cookie-reject]").click();
      await expect(page.locator("main h1")).toHaveCount(1);
      const back = await page.locator("main .blog-back").first().boundingBox();
      const header = await page.locator("nav").first().boundingBox();
      assert.ok(back.y >= header.y + header.height, "The fixed header must not cover the back link");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${pre}/blog/$`));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const compare = page.locator("main a.blog-link");
      const sitemap = await (await page.request.get(`${base}/sitemap-0.xml`)).text();
      assert.ok(!sitemap.includes("/blog/unpublished-draft/"));
      if (slug) assert.ok(sitemap.includes(`${pre}/blog/${slug}/`));
      if (!slug) {
        await expect(page.locator(".blog-empty")).toBeVisible();
        await expect(page.locator(".blog-row")).toHaveCount(0);
        await compare.click();
        await expect(page).toHaveURL(`${base}${pre}/compare/`);
        await page.goBack();
      } else {
        await page.locator(`.blog-row[href$="/blog/${slug}/"]`).click();
        await expect(page.locator("main article")).toBeVisible();
        await expect(page.locator(".blog-prose h2")).toBeVisible();
        await expect(page.locator(".blog-sources a").first()).toHaveAttribute(
          "href",
          "https://example.com/research/topic",
        );
        await expect(page.locator("time").first()).toHaveAttribute("datetime", "2026-01-01");
        if (process.env.DOCS_TEST_IMAGE === "1") {
          const image = page.locator(".blog-cover img");
          await expect(image).toHaveAttribute("alt", lang === "es" ? "Imagen de verificación" : "Verification image");
          await expect(image).toHaveAttribute("width", "1600");
          await expect(image).toHaveAttribute("height", "900");
          await expect(image).toHaveAttribute("srcset", /400w.*800w.*1200w.*1600w/);
          await expect(image).toHaveAttribute("sizes", /760px/);
          assert.ok(await image.evaluate((element) => element.complete && element.naturalWidth > 0));
          await expect(page.locator(".blog-cover figcaption")).toContainText(
            lang === "es" ? "no captura" : "not an APX screenshot",
          );
          const social = await page.locator('meta[property="og:image"]').getAttribute("content");
          assert.ok(social.includes("/_astro/") && social.endsWith(".webp"));
          assert.equal((await page.request.get(`${new URL(base).origin}${new URL(social).pathname}`)).status(), 200);
          await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
          await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "675");
        }
        const data = await page.locator('script[type="application/ld+json"]').allTextContents();
        assert.ok(data.map((item) => JSON.parse(item)).some((item) => item["@type"] === "BlogPosting"));
      }
      await page
        .locator(".lang a")
        .filter({ hasText: lang === "en" ? "ES" : "EN" })
        .click();
      await expect(page).toHaveURL(`${base}${lang === "en" ? "/es" : ""}/blog/${slug ? `${slug}/` : ""}`);
      await page.goto(`${base}${pre}/blog/`, { waitUntil: "networkidle" });
      await page.locator("#theme").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      if (output)
        await page.screenshot({
          path: join(output, `${width}-${lang}-${slug ? "filled" : "empty"}-light.png`),
          fullPage: true,
        });
      await page.locator("#theme").click();
      if (output)
        await page.screenshot({
          path: join(output, `${width}-${lang}-${slug ? "filled" : "empty"}-dark.png`),
          fullPage: true,
        });
      if (width === 390) {
        await page.locator(".nav__toggle").click();
        await expect(page.locator(".nav__links").getByRole("link", { name: "Blog", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator(".nav__toggle")).toHaveAttribute("aria-expanded", "false");
      }
      if (slug) {
        await page.goto(`${base}${pre}/blog/${slug}/`, { waitUntil: "networkidle" });
        if (output) await page.screenshot({ path: join(output, `${width}-${lang}-article.png`), fullPage: true });
      }
      const missing = await page.goto(`${base}${pre}/blog/unpublished-draft/`);
      assert.equal(missing.status(), 404);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log("Blog navigation, language, themes, responsive layout and unpublished route checks passed.");
