import { expect, test } from "@playwright/test";
import { featured } from "../../../apps/docs/src/data/comparisons.ts";

for (const lang of ["en", "es"] as const) {
  const pre = lang === "es" ? "/es" : "";
  test(`${lang}: home questions and comparison cards work in both themes`, async ({ page }, testInfo) => {
    await page.goto(`${pre}/`);
    await page
      .locator(".web-footer")
      .getByRole("link", { name: lang === "es" ? "Preguntas" : "Questions", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${pre}/#questions$`));
    const questions = page.locator("#questions");
    await expect(questions.locator("details")).toHaveCount(6);
    for (const detail of await questions.locator("details").all()) {
      const summary = detail.locator("summary");
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(detail).toHaveAttribute("open", "");
      await expect(detail.locator(".home-questions__answer")).toBeVisible();
      await expect(detail.getByRole("link")).toHaveAttribute("href", new RegExp(`${pre}/docs/`));
      await page.keyboard.press("Space");
      await expect(detail).not.toHaveAttribute("open", "");
    }
    await questions.locator("summary").first().click();
    const cards = page.locator(".home-comparisons__card");
    // The six most relevant comparisons, in the data's order.
    await expect(cards).toHaveCount(6);
    expect(featured.map((item) => item.slug)).toEqual([
      "claude-cowork",
      "chatgpt-dots",
      "openclaw",
      "manus",
      "hermes-agent",
      "openbot",
    ]);
    for (const [index, product] of featured.entries()) {
      const slug = product.slug;
      await expect(cards.nth(index)).toContainText(`APX vs ${product?.name}`);
      await expect(cards.nth(index)).toContainText(product?.tagline[lang] ?? "\0");
      await expect(cards.nth(index)).toHaveAttribute("href", `${pre}/compare/${slug}/`);
      await cards.nth(index).scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          cards
            .nth(index)
            .locator(".home-comparisons__logo img")
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await questions.screenshot({ path: testInfo.outputPath(`questions-${theme}.png`) });
      await page
        .locator(".home-comparisons")
        .screenshot({ path: testInfo.outputPath(`cards-${theme}.png`), style: ".web-header { visibility: hidden; }" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Nothing wider than the screen may stretch the page either (a phone would zoom out to fit it).
      expect(await page.evaluate(() => innerWidth)).toBe(page.viewportSize()?.width);
    }
    await cards.first().click();
    await expect(page).toHaveURL(`${pre}/compare/${featured[0]?.slug}/`);
    await page
      .locator(".web-footer")
      .getByRole("link", { name: lang === "es" ? "Preguntas" : "Questions", exact: true })
      .click();
    await expect(page.locator("#questions")).toBeInViewport();
  });

  test(`${lang}: final crew invitation follows downloads immediately before the footer`, async ({ page }, testInfo) => {
    await page.goto(`${pre}/`);
    const final = page.locator(".final");
    // The map, the terminal, questions, comparisons and downloads come before it; it closes the page, right above the footer.
    await expect(page.locator("#map + #terminal + #questions + #compare + #download + .final:last-child")).toHaveCount(
      1,
    );
    await expect(page.locator("main:has(> .final:last-child) + .web-footer")).toHaveCount(1);
    await expect(final.getByRole("heading", { level: 2 })).toHaveText(
      lang === "es" ? "Tu crew te está esperando." : "Your crew is waiting.",
    );
    await expect(final.locator(".parade .apx-blob")).toHaveCount(35);
    await expect(final.locator(".final__actions a")).toHaveCount(2);
    await expect(final.locator(".btn-light")).toHaveAttribute("href", "#download");
    await expect(final.locator(".btn-light")).toHaveText(lang === "es" ? "Bajar la app" : "Download the app");
    await expect(final.locator(".btn-discord")).toHaveAttribute("href", "https://discord.gg/vxdZuT5WuE");
    await expect(final.locator(".btn-discord svg")).toBeVisible();
    await final.scrollIntoViewIfNeeded();
    await expect(final.locator(".final__title")).toBeVisible();
    await final.screenshot({ path: testInfo.outputPath("final-crew.png") });
    await final.locator(".btn-light").click();
    await expect(page).toHaveURL(`${pre}/#download`);
    await expect(page.locator("#download h2")).toBeInViewport();
  });

  test(`${lang}: questions work without JavaScript`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${pre}/`);
    const first = page.locator("#questions details").first();
    await first.locator("summary").click();
    await expect(first.locator(".home-questions__answer")).toBeVisible();
    await expect(page.locator(".home-comparisons__card")).toHaveCount(6);
    await context.close();
  });
}
