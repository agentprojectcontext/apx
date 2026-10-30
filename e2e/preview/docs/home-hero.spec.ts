import { expect, test } from "@playwright/test";
import { comparisons, featuredComparison } from "../../../apps/docs/src/data/comparisons.ts";

for (const lang of ["en", "es"] as const) {
  const pre = lang === "es" ? "/es" : "";

  test(`${lang}: the header's Compare menu opens on hover and focus and leads to comparisons`, async ({
    page,
    isMobile,
  }, testInfo) => {
    test.skip(isMobile, "Below 1000 px the links live in the menu sheet, without the dropdown");
    await page.goto(`${pre}/`);
    const menu = page.locator(".web-header .nav__menu");
    await expect(menu).toBeHidden();
    await page.locator(".nav__cmp-link").hover();
    await expect(menu).toBeVisible();
    const featured = comparisons.find((item) => item.slug === featuredComparison);
    const card = menu.locator(".nav__feat");
    await expect(card).toHaveAttribute("href", `${pre}/compare/${featuredComparison}/`);
    await expect(card).toContainText(`APX vs ${featured?.name}`);
    await expect(card.locator(".nav__feat-new")).toHaveText(lang === "es" ? "Nuevo" : "New");
    const items = menu.locator(".nav__menu-list a");
    await expect(items).toHaveCount(4);
    for (const item of await items.all()) {
      await expect(item).toHaveAttribute("href", new RegExp(`^${pre}/compare/[a-z-]+/$`));
      expect(await item.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    }
    await expect(menu.locator(".nav__menu-foot a")).toHaveAttribute("href", `${pre}/compare/#comparisons`);
    await page.screenshot({ path: testInfo.outputPath("compare-menu.png") });
    // The pointer leaving closes it, after a short grace.
    await page.mouse.move(700, 700);
    await expect(menu).toBeHidden();
    // From the keyboard, focusing Compare opens it and its links are reachable.
    await page.locator(".nav__cmp-link").focus();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(card).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${pre}/compare/${featuredComparison}/`);
  });

  test(`${lang}: the header becomes a bar once the page scrolls`, async ({ page }) => {
    await page.goto(`${pre}/`);
    const header = page.locator(".web-header");
    await expect(header).not.toHaveAttribute("data-scrolled");
    await page.evaluate(() => scrollTo(0, 400));
    await expect(header).toHaveAttribute("data-scrolled", "");
    await page.evaluate(() => scrollTo(0, 0));
    await expect(header).not.toHaveAttribute("data-scrolled");
  });

  test(`${lang}: the install panel floats over the status line without moving the page`, async ({ page }) => {
    await page.goto(`${pre}/`);
    const stage = page.locator("[data-stage-card]");
    const before = await stage.boundingBox();
    const status = page.locator("#status");
    await expect(status).toBeVisible();
    await page.locator(".hero__term").click();
    await expect(page.locator("#heroInstall")).toBeVisible();
    await expect(page.locator(".hero__term")).toHaveAttribute("aria-expanded", "true");
    await expect(status).toHaveClass(/is-away/);
    expect((await stage.boundingBox())?.y).toBe(before?.y);
    await page.locator("#heroInstall [data-term='server']").click();
    await expect(page.locator("#heroInstall [data-pane='server'] code")).toHaveText(
      "curl -fsSL https://apxagent.app/install.sh | bash -s -- --server",
    );
    await page.locator(".hero__term").click();
    await expect(page.locator("#heroInstall")).toBeHidden();
    await expect(status).not.toHaveClass(/is-away/);
  });
}

test("the hero keeps its glow when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === "webgl") return null;
      return (original as (...args: unknown[]) => RenderingContext | null).call(this, kind, ...rest);
    } as typeof original;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".hero")).not.toHaveClass(/has-horizon/);
  await expect(page.locator(".hero__aura")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the hero lights the stage card when WebGL is available", async ({ page }) => {
  await page.goto("/");
  const webgl = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl")));
  test.skip(!webgl, "This browser has no WebGL");
  await expect(page.locator(".hero")).toHaveClass(/has-horizon/);
  await expect(page.locator(".hero__aura")).toBeHidden();
});
