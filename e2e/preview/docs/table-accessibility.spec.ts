import { expect, test } from "@playwright/test";

test("light-theme supporting copy has readable contrast", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("starlight-theme", "light"));
  await page.goto("/compare/hermes-agent/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const ratio = await page.locator(".compare-intro").evaluate((element) => {
    const luminance = (color: string) => {
      const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
        const value = Number(part) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
    };
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(document.body).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

for (const pre of ["", "/es"]) {
  test(`${pre || "en"}: comparison keeps native table and header associations at every width`, async ({
    page,
  }, testInfo) => {
    await page.goto(`${pre}/compare/hermes-agent/`);
    const table = page.getByRole("table");
    await expect(table).toHaveCount(1);
    await expect(table.getByRole("columnheader")).toHaveCount(3);
    await expect(table.getByRole("rowheader")).toHaveCount(8);
    await expect(table.getByRole("cell")).toHaveCount(16);
    for (const header of await table.getByRole("columnheader").all()) await expect(header).toBeVisible();
    expect(await table.evaluate((element) => getComputedStyle(element).display)).toBe("table");
    expect(await table.locator("thead").evaluate((element) => getComputedStyle(element).display)).toBe(
      "table-header-group",
    );
    expect(
      await table
        .locator("tbody tr")
        .first()
        .evaluate((element) => getComputedStyle(element).display),
    ).toBe("table-row");
    expect(await table.locator("th[scope='row']").count()).toBe(8);
    expect(await table.locator("th[scope='col']").count()).toBe(3);
    const region = page.getByRole("region", { name: /^APX vs Hermes Agent/ });
    await region.scrollIntoViewIfNeeded();
    await region.focus();
    const overflowing = await region.evaluate((element) => element.scrollWidth > element.clientWidth);
    if (overflowing) {
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await table.locator("thead").scrollIntoViewIfNeeded();
    await region.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await page.screenshot({ path: testInfo.outputPath("native-table.png") });
  });
}
