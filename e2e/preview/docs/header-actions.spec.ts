import { expect, test } from "@playwright/test";

for (const lang of ["en", "es"]) {
  const pre = lang === "es" ? "/es" : "";
  test(`${lang}: shared header retains all actions and download destination`, async ({ page }, testInfo) => {
    for (const path of ["/", "/compare/", "/compare/hermes-agent/"]) {
      await page.goto(`${pre}${path}`);
      const header = page.locator(".web-header");
      for (const name of ["EN", "ES", "GitHub", "Discord", lang === "es" ? "Bajar la app" : "Download the app"]) {
        const action = header.getByRole("link", { name, exact: true });
        await expect(action).toBeVisible();
        await action.focus();
        await expect(action).toBeFocused();
      }
      const github = header.getByRole("link", { name: "GitHub", exact: true });
      await expect(github).toHaveAttribute("href", "https://github.com/agentprojectcontext/apx");
      await expect(github.locator("svg")).toBeVisible();
      const discord = header.getByRole("link", { name: "Discord", exact: true });
      await expect(discord).toHaveAttribute("href", "https://discord.gg/vxdZuT5WuE");
      await expect(discord.locator("svg")).toBeVisible();
      const download = header.locator(".nav__get");
      await expect(download).toHaveAttribute("href", `${pre}/#download`);
      await expect(download.locator("svg")).toBeVisible();
      expect(await download.locator("svg").evaluate((svg) => getComputedStyle(svg).stroke)).not.toBe("none");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `${path === "/" ? "home" : path === "/compare/" ? "index" : "comparison"}-header.png`,
        ),
      });
      await download.click();
      await expect(page).toHaveURL(`${pre}/#download`);
      await expect(page.locator("#download h2")).toBeInViewport();
    }
    for (const width of [320, 768, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${pre}/compare/hermes-agent/`);
      await expect(page.locator(".web-header .web-repo")).toBeVisible();
      await expect(page.locator(".web-header .nav__get")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
