import { expect, test } from "@playwright/test";
import { comparisons } from "../../../apps/docs/src/data/comparisons.ts";
import { readingNav } from "../web-nav.ts";

const tagline = (slug: string, lang: "en" | "es") =>
  comparisons.find((item) => item.slug === slug)?.tagline[lang] ?? "";

for (const lang of ["en", "es"] as const) {
  const prefix = lang === "es" ? "/es" : "";
  for (const [slug, name] of [
    ["hermes-agent", "Hermes Agent"],
    ["openclaw", "OpenClaw"],
    ["openbot", "OpenBot"],
    ["claude-cowork", "Claude Cowork"],
    ["chatgpt-dots", "ChatGPT dots"],
    ["manus", "Manus"],
    ["devin", "Devin"],
    ["paperclip", "Paperclip"],
    ["viktor", "Viktor"],
    ["grok-bot", "Grok Bot"],
    ["muse", "Muse"],
    ["instinct", "Instinct"],
  ] as const) {
    test(`${lang}: ${name} sources, language, reading progress and responsive layout`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${prefix}/compare/${slug}/`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`APX vs ${name}: ${tagline(slug, lang)}`);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      const rows = page.locator(".compare-table tbody tr");
      await expect(rows).toHaveCount(8);
      await expect(rows.nth(1).locator("td").first()).toContainText("Android");
      for (const cell of await page.locator(".compare-table tbody td").all()) {
        expect(await cell.locator(".row-sources a").count()).toBeGreaterThan(0);
        for (const source of await cell.locator(".row-sources a").all()) {
          await expect(source).toHaveAttribute("href", /^https:/);
          await expect(source).toHaveAccessibleName(new RegExp(`^${lang === "es" ? "Fuente" : "Source"}:`));
        }
      }
      if (slug === "openclaw") {
        await expect(rows.nth(3).locator("td:last-child a")).toHaveAttribute(
          "href",
          "https://docs.openclaw.ai/concepts/multi-agent",
        );
        await expect(rows.nth(5).locator("td:last-child a").first()).toHaveAttribute(
          "href",
          "https://docs.openclaw.ai/automation/cron-jobs",
        );
      }
      if (slug === "openbot") {
        for (const platform of ["Slack", "Discord", "Telegram"])
          await expect(rows.nth(5).locator("td").last()).toContainText(platform);
        await expect(rows.nth(7).locator("td").last()).toContainText("PolyForm Noncommercial 1.0.0");
      }
      // Every image in the page's content and footer; the reading navigation's blob is checked once it shows.
      for (const image of await page.locator("main img, .web-footer img").all()) {
        await image.scrollIntoViewIfNeeded();
        await expect(image).toHaveJSProperty("complete", true);
        expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.evaluate(() => window.innerWidth)).toBe(page.viewportSize()?.width);
      await page.locator("h1").scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath("hero.png") });
      const rail = await readingNav(page, lang);
      await rail.locator('a[href="#overview"]').click();
      await expect(page).toHaveURL(/#overview$/);
      await expect(rail.locator('[aria-current="location"]')).toHaveAttribute("href", "#overview");
      const guide = rail.locator(".apx-blob img:visible").first();
      await expect(guide).toHaveJSProperty("complete", true);
      expect(await guide.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await page.screenshot({ path: testInfo.outputPath("table.png") });
      await page
        .locator("#sources")
        .evaluate((section) => section.scrollIntoView({ block: "start", behavior: "instant" }));
      await expect(rail.locator('[aria-current="location"]')).toHaveAttribute("href", "#sources");
      // Every page a row cites is listed with its title under Sources.
      const listed = await page
        .locator("#source-other a")
        .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
      expect(listed.length).toBeGreaterThan(1);
      for (const href of await page
        .locator(".compare-table td:last-child .row-sources a")
        .evaluateAll((links) => links.map((a) => a.getAttribute("href"))))
        expect(listed).toContain(href);
      await page.screenshot({ path: testInfo.outputPath("sources.png") });
      await page.getByRole("link", { name: lang === "es" ? "EN" : "ES", exact: true }).click();
      await expect(page).toHaveURL(`${lang === "es" ? "" : "/es"}/compare/${slug}/`);
      await expect(page.locator("html")).toHaveAttribute("lang", lang === "es" ? "en" : "es");
      expect(errors).toEqual([]);
    });
  }
  test(`${lang}: comparison index leads to each product`, async ({ page }) => {
    await page.goto(`${prefix}/compare/`);
    await expect(page.locator(".comparison-card")).toHaveCount(12);
    await expect(page.locator('.comparison-card[aria-current="page"]')).toHaveCount(0);
    await page.locator('.comparison-card[href$="/openbot/"]').click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`APX vs OpenBot: ${tagline("openbot", lang)}`);
    // Keep comparing lists every product, the one being read marked as such.
    await expect(page.locator(".comparison-card")).toHaveCount(12);
    await expect(page.locator('.comparison-card[aria-current="page"]')).toHaveAttribute(
      "href",
      `${prefix}/compare/openbot/`,
    );
    await page.locator('.comparison-card[href$="/hermes-agent/"]').click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `APX vs Hermes Agent: ${tagline("hermes-agent", lang)}`,
    );
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`blob bodies and eyes appear together (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    let releaseBodies = () => {};
    const bodiesHeld = new Promise<void>((resolve) => {
      releaseBodies = resolve;
    });
    await page.route("**/*.webp", async (route) => {
      await bodiesHeld;
      await route.continue();
    });
    try {
      await page.goto("/es/compare/openbot/", { waitUntil: "domcontentloaded" });
      // Home in the hero's chat, four in the short answer, Scout, and the crew card.
      const blobs = page.locator(".compare-main .apx-blob");
      await expect(blobs).toHaveCount(9);
      for (const blob of await blobs.all()) {
        expect(await blob.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(0);
        await expect(blob.locator("svg")).toBeHidden();
        await expect(blob.locator("img")).toHaveAttribute("loading", "lazy");
      }
      releaseBodies();
      for (const blob of await blobs.all()) {
        await blob.scrollIntoViewIfNeeded();
        await expect(blob.locator("svg")).toBeVisible();
        expect(await blob.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      }
    } finally {
      releaseBodies();
    }
  });
}

test("failed blob bodies never leave visible eyes", async ({ page }) => {
  await page.route("**/*.webp", (route) => route.abort());
  await page.goto("/compare/hermes-agent/");
  const blobs = page.locator(".compare-main .apx-blob");
  await expect(blobs).toHaveCount(9);
  for (const blob of await blobs.all()) {
    await blob.scrollIntoViewIfNeeded();
    await expect(blob.locator("img")).toHaveJSProperty("complete", true);
    await expect(blob.locator("svg")).toBeHidden();
    await expect(blob.locator("img")).toHaveJSProperty("naturalWidth", 0);
  }
});

test("reading navigation works from the keyboard", async ({ page }) => {
  await page.goto("/compare/hermes-agent/");
  const link = (await readingNav(page)).locator('a[href="#difference"]');
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#difference$/);
  await expect(link).toHaveAttribute("aria-current", "location");
});
