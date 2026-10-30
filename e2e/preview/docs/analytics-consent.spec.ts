import { expect, test } from "@playwright/test";
import { checkConsent } from "../consent-check.ts";

for (const pre of ["", "/es"]) {
  for (const path of ["/", "/docs/reference/website-privacy/", "/compare/", "/compare/hermes-agent/"]) {
    test(`${pre || "en"}${path}: shared analytics consent and privacy navigation`, async ({ page, baseURL }) => {
      if (!baseURL) throw new Error("The docs preview URL is required");
      await checkConsent(page, baseURL, pre, path);
    });
  }
}

// Site styles must not repaint the consent controls: their text stays light on their dark card in both themes.
for (const colorScheme of ["light", "dark"] as const) {
  for (const path of ["/", "/compare/manus/"]) {
    test(`${path}: consent controls keep their own colors in the ${colorScheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(path);
      await expect(page.locator("[data-cookie-panel] p").first()).toHaveCSS("color", "rgb(243, 244, 246)");
      await expect(page.locator("[data-cookie-panel] a").first()).toHaveCSS("color", "rgb(180, 241, 212)");
      await page.locator("[data-cookie-reject]").click();
      const settings = page.locator("[data-cookie-settings]");
      await expect(settings).toHaveCSS("color", "rgb(243, 244, 246)");
      await expect(settings).toHaveCSS("font-family", /Geist/);
    });
  }
}
