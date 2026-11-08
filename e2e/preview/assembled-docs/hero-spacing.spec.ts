import { expect, test } from "./site.fixture.ts";

for (const lang of ["en", "es"]) {
  for (const width of [390, 680, 1440]) {
    test(`the ${lang} preview stays close to the activity badge at ${width}px`, async ({
      page,
      assembledOrigin,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${assembledOrigin}${lang === "es" ? "/es/" : "/"}`);
      await page.evaluate(() => document.fonts.ready);
      await page.getByRole("button", { name: lang === "es" ? "Rechazar" : "Decline", exact: true }).click();
      const badge = page.locator("#status");
      const preview = page.locator(".stage__shot");
      await expect(badge).toBeVisible();
      await expect(preview).toBeVisible();
      const gap = await preview.evaluate((el) => {
        const status = document.querySelector("#status");
        if (!status) throw new Error("Missing activity badge");
        return el.getBoundingClientRect().top - status.getBoundingClientRect().bottom;
      });
      expect(gap).toBeGreaterThanOrEqual(40);
      expect(gap).toBeLessThanOrEqual(100);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const path = testInfo.outputPath(`spacing-${lang}-${width}.png`);
      await page.screenshot({ path });
      await testInfo.attach("Hero spacing", { path, contentType: "image/png" });

      const before = await preview.boundingBox();
      await page.locator(".hero__term").click();
      await expect(page.locator("#heroInstall")).toBeVisible();
      await expect(badge).toHaveClass(/is-away/);
      for (const tab of await page.locator(".hero__tabs button").all()) {
        await tab.click();
        await expect(tab).toHaveAttribute("aria-pressed", "true");
        const command = page.locator(".hero__pane:not([hidden]) .cmd");
        await expect(command).toBeVisible();
        const note = page.locator(".hero__pane:not([hidden]) .hero__note");
        expect(
          await note.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return [0.1, 0.5, 0.9].every((part) =>
              el.contains(document.elementFromPoint(rect.x + rect.width * part, rect.y + rect.height / 2)),
            );
          }),
        ).toBe(true);
        expect(
          await command.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          }),
        ).toBe(true);
      }
      expect(await preview.boundingBox()).toEqual(before);
      await page.locator(".hero__term").click();
      await expect(page.locator("#heroInstall")).toBeHidden();
      await expect(badge).not.toHaveClass(/is-away/);
    });
  }
}
