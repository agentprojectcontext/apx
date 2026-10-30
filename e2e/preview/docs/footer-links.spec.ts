import { expect, test } from "@playwright/test";
import { comparisons } from "../../../apps/docs/src/data/comparisons.ts";

for (const lang of ["en", "es"] as const) {
  const pre = lang === "es" ? "/es" : "";

  test(`${lang}: every footer link resolves, in this language`, async ({ page, request }) => {
    await page.goto(`${pre}/compare/`);
    const footer = page.locator(".web-footer");
    const hrefs = await footer
      .locator(".web-footer__row a")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThanOrEqual(60);
    expect(hrefs).toContain("mailto:manu@incubit.com.ar");
    // Every comparison is listed, not just the first few.
    for (const item of comparisons) expect(hrefs).toContain(`${pre}/compare/${item.slug}/`);
    for (const href of new Set(hrefs)) {
      if (href.startsWith("mailto:")) continue;
      if (/^https?:/.test(href)) {
        expect(href).toMatch(/^https:\/\/(github\.com|discord\.gg|www\.youtube\.com)\//);
        continue;
      }
      if (lang === "es") expect(href, "a Spanish page").toMatch(/^\/es\//);
      const [path, fragment] = href.split("#");
      const response = await request.get(path ?? "/");
      expect(response.status(), href).toBe(200);
      if (fragment) expect(await response.text(), href).toContain(`id="${fragment}"`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("on a phone the footer's columns stack in two, Compare folds, and links are full size @phone", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("apx-website-analytics-v1", "declined"));
  await page.goto("/es/");
  const groups = page.locator(".web-footer");
  await groups.locator(".web-footer__row").first().scrollIntoViewIfNeeded();
  const columns = await groups
    .locator(".web-footer__row .web-footer__col:not(.web-footer__col--compare)")
    .evaluateAll((cols) => [...new Set(cols.map((n) => Math.round(n.getBoundingClientRect().left)))]);
  expect(columns).toHaveLength(2);
  // The long list of comparisons starts folded, and opens.
  const fold = groups.locator(".web-footer__fold");
  await expect(fold).not.toHaveAttribute("open");
  await fold.locator("summary").tap();
  await expect(fold).toHaveAttribute("open", "");
  await expect(fold.locator("a").first()).toBeVisible();
  for (const link of await groups.locator(".web-footer__row a").all()) {
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
