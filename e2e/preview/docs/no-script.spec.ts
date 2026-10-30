import { expect, test } from "@playwright/test";

test.use({ javaScriptEnabled: false });

for (const pre of ["", "/es"]) {
  test(`${pre || "en"}: legacy documentation redirects without scripts`, async ({ page }) => {
    await page.goto(`${pre}/start/introduction/`);
    await expect(page).toHaveURL(`${pre}/docs/start/introduction/`);
    await expect(page.locator("main h1")).toBeVisible();
  });
}

test("comparison navigation and sources remain usable without scripts", async ({ page }) => {
  await page.goto("/compare/hermes-agent/");
  await expect(page.locator(".reading-rail [aria-current]")).toHaveCount(0);
  await page.locator('.reading-rail a[href="#sources"]').click();
  await expect(page).toHaveURL(/#sources$/);
  await expect(page.getByRole("heading", { name: "Sources and scope", exact: true })).toBeInViewport();
  await page.getByRole("link", { name: "ES", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.locator('.comparison-card[href$="/openclaw/"]').click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("APX vs OpenClaw");
});
