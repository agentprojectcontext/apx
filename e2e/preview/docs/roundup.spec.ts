import { expect, test } from "@playwright/test";
import { roundupApps, roundupTitle } from "../../../apps/docs/src/data/roundup/index.ts";
import { readingNav } from "../web-nav.ts";

for (const lang of ["en", "es"] as const) {
  const pre = lang === "es" ? "/es" : "";

  test(`${lang}: the roundup compares 17 apps with their sources, and leads to our comparisons`, async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${pre}/compare/best-ai-agent-apps/`);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(roundupTitle[lang]);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://apxagent.app${pre}/compare/best-ai-agent-apps/`,
    );
    expect(roundupApps).toHaveLength(17);
    await expect(page.locator(".roundup-table tr.app-row")).toHaveCount(17);
    await expect(page.locator(".roundup-table tr.group-row")).toHaveCount(4);
    await expect(page.locator(".app-card")).toHaveCount(17);
    await expect(page.locator(".bench-table tbody tr")).toHaveCount(5);
    await expect(page.locator(".bench-meta a")).toHaveCount(2);
    // Every source is https, and every link to one of our comparisons answers.
    const external = await page
      .locator("#main a[href^='http'], #main a[href^='//']")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
    expect(external.length).toBeGreaterThan(50);
    for (const href of external) expect(href, href).toMatch(/^https:\/\//);
    for (const app of roundupApps.filter((a) => a.comparePage)) {
      const link = page.locator(`#app-${app.slug} .app-card__compare`);
      await expect(link).toHaveAttribute("href", `${pre}/compare/${app.comparePage}/`);
      expect((await request.get(`${pre}/compare/${app.comparePage}/`)).status()).toBe(200);
    }
    // The reading navigation works here too.
    const nav = await readingNav(page, lang);
    await nav.locator('a[href="#numbers"]').click();
    await expect(nav.locator('[aria-current="location"]')).toHaveAttribute("href", "#numbers");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => innerWidth)).toBe(page.viewportSize()?.width);
    expect(errors).toEqual([]);
  });

  test(`${lang}: the roundup is linked from the comparison index, the header and the footer`, async ({ page }) => {
    await page.goto(`${pre}/compare/`);
    const destination = `${pre}/compare/best-ai-agent-apps/`;
    await expect(page.locator(".roundup-card")).toHaveAttribute("href", destination);
    await expect(page.locator(`.web-header .nav__cmp a[href="${destination}"]`)).toHaveCount(1);
    await expect(page.locator(`.web-footer a[href="${destination}"]`)).toHaveCount(1);
    await page.locator(".roundup-card").click();
    await expect(page).toHaveURL(destination);
  });
}

test("on a phone the roundup's table scrolls sideways with the app column in view @phone", async ({ page }) => {
  await page.goto("/compare/best-ai-agent-apps/");
  const region = page.locator(".roundup-table-wrap");
  await region.scrollIntoViewIfNeeded();
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const first = page.locator(".roundup-table tr.app-row th").first();
  const before = await first.boundingBox();
  await region.evaluate((el) => {
    el.scrollLeft = 300;
  });
  expect((await first.boundingBox())?.x).toBe(before?.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
