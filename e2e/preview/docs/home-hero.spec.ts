import { expect, test } from "@playwright/test";
import { comparisons, featuredComparison } from "../../../apps/docs/src/data/comparisons.ts";
import { decodePng } from "../png.ts";

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

for (const theme of ["dark", "light"] as const) {
  test(`the horizon hugs only the stage card, with no seam (${theme})`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("starlight-theme", value), theme);
    await page.goto("/");
    const webgl = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl")));
    test.skip(!webgl, "This browser has no WebGL");
    await expect(page.locator(".hero")).toHaveClass(/has-horizon/);
    await page.locator("[data-analytics-consent] [data-cookie-reject]").click();
    const card = page.locator("[data-stage-card]");
    const shoot = async (cardTop: number) => {
      await page.evaluate((top) => {
        const box = document.querySelector("[data-stage-card]")?.getBoundingClientRect();
        if (box) scrollTo(0, scrollY + box.top - top);
      }, cardTop);
      await page.waitForTimeout(600);
      const box = await card.boundingBox();
      if (!box) throw new Error("No stage card");
      return { box, pixels: decodePng(await page.screenshot()) };
    };
    const luma = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const width = page.viewportSize()?.width ?? 0;
    // Around the top corners the glow changes smoothly: no step between neighbouring pixels. The first 10 px hug
    // the card with its own bright rim, so sampling starts past them.
    const top = await shoot(260);
    await testInfo.attach("corners.png", { body: await page.screenshot(), contentType: "image/png" });
    const steps: number[] = [];
    for (const edge of [top.box.x + top.box.width + 10, top.box.x - 11]) {
      if (edge < 1 || edge > width - 2) continue;
      for (let y = top.box.y - 40; y < top.box.y + 80; y++)
        steps.push(Math.abs(luma(top.pixels.at(edge, y + 1)) - luma(top.pixels.at(edge, y))));
    }
    for (const y of [top.box.y + 4, top.box.y + 24]) {
      for (let x = top.box.x + top.box.width + 10; x < width - 2; x++)
        steps.push(Math.abs(luma(top.pixels.at(x + 1, y)) - luma(top.pixels.at(x, y))));
      for (let x = 1; x < top.box.x - 11; x++)
        steps.push(Math.abs(luma(top.pixels.at(x + 1, y)) - luma(top.pixels.at(x, y))));
    }
    expect(Math.max(0, ...steps)).toBeLessThanOrEqual(8);
    // Past the card's bottom (its caption, the next section) no light is added to the page: no channel is brighter
    // than the background (the card's drop shadow may only darken it).
    const bottom = await shoot(-((await card.boundingBox())?.height ?? 0) + 200);
    const background = await page.evaluate(() =>
      (getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number),
    );
    await testInfo.attach("below-card.png", { body: await page.screenshot(), contentType: "image/png" });
    const gutters = [
      2,
      Math.max(2, bottom.box.x - 4),
      Math.min(width - 3, bottom.box.x + bottom.box.width + 4),
      width - 3,
    ];
    for (let y = bottom.box.y + bottom.box.height + 16; y < bottom.box.y + bottom.box.height + 400; y += 8)
      for (const x of gutters) {
        const [r, g, b] = bottom.pixels.at(x, y);
        expect(
          Math.max(r - (background[0] ?? 0), g - (background[1] ?? 0), b - (background[2] ?? 0)),
          `light at ${x},${Math.round(y)}`,
        ).toBeLessThanOrEqual(2);
      }
  });
}
