import { expect, test } from "@playwright/test";
import { featured } from "../../../apps/docs/src/data/comparisons.ts";
import { decodePng } from "../png.ts";

for (const lang of ["en", "es"] as const) {
  const pre = lang === "es" ? "/es" : "";

  // Below 1000 px the links live in the menu sheet, without the dropdown.
  test(`${lang}: the header's Compare menu opens on hover and focus and leads to comparisons @desktop`, async ({
    page,
  }, testInfo) => {
    await page.goto(`${pre}/`);
    const menu = page.locator(".web-header .nav__cmp .nav__menu");
    await expect(menu).toBeHidden();
    await page.locator(".nav__cmp-link").hover();
    await expect(menu).toBeVisible();
    // The most relevant comparison as the card, the next three beside it, in the data's order.
    const [lead, ...rest] = featured;
    const card = menu.locator(".nav__feat");
    await expect(card).toHaveAttribute("href", `${pre}/compare/${lead?.slug}/`);
    await expect(card).toContainText(`APX vs ${lead?.name}`);
    await expect(card.locator(".nav__feat-date")).toBeVisible();
    // The blob sits inside the card, never past its edge.
    const cardBox = await card.boundingBox();
    const blobBox = await card.locator(".nav__feat-blob").boundingBox();
    expect(blobBox?.x ?? 0).toBeGreaterThanOrEqual(cardBox?.x ?? 0);
    expect((blobBox?.x ?? 0) + (blobBox?.width ?? 0)).toBeLessThanOrEqual((cardBox?.x ?? 0) + (cardBox?.width ?? 0));
    expect(blobBox?.y ?? 0).toBeGreaterThanOrEqual(cardBox?.y ?? 0);
    await expect(card.locator(".nav__feat-new")).toHaveText(lang === "es" ? "Nuevo" : "New");
    const items = menu.locator(".nav__menu-list a");
    await expect(items).toHaveCount(3);
    for (const [i, item] of (await items.all()).entries()) {
      await expect(item).toHaveAttribute("href", `${pre}/compare/${rest[i]?.slug}/`);
      expect(await item.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    }
    await expect(menu.locator(".nav__menu-foot a").last()).toHaveAttribute("href", `${pre}/compare/#comparisons`);
    await expect(menu.locator(".nav__menu-foot a").first()).toHaveAttribute(
      "href",
      `${pre}/compare/best-ai-agent-apps/`,
    );
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
    await expect(page).toHaveURL(`${pre}/compare/${lead?.slug}/`);
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

test("the hero lights the stage card with WebGL and shows the aura without it", async ({ page }) => {
  await page.goto("/");
  const webgl = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl")));
  if (webgl) {
    await expect(page.locator(".hero")).toHaveClass(/has-horizon/);
    await expect(page.locator(".hero__aura")).toBeHidden();
  } else await expect(page.locator(".hero__aura")).toBeVisible();
});

for (const theme of ["dark", "light"] as const) {
  test(`the horizon hugs only the stage card, with no seam (${theme})`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("starlight-theme", value), theme);
    await page.goto("/");
    const webgl = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl")));
    expect(webgl, "the horizon needs WebGL").toBe(true);
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

for (const lang of ["en", "es"] as const) {
  const pre = lang === "es" ? "/es" : "";
  const entries =
    lang === "es" ? ["Producto", "Guías", "Comparar", "Preguntas"] : ["Product", "Docs", "Compare", "Questions"];
  const paths = ["/#what", "/docs/start/introduction/", "/compare/", "/#questions"];

  test(`${lang}: the header's pill is Product, Docs, Compare and Questions, and never overflows`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(`${pre}/compare/openbot/`);
    const toggle = page.locator(".web-header .nav__toggle");
    if (isMobile) {
      await toggle.click();
      await expect(page.locator(".web-header")).toHaveAttribute("data-open", "");
    }
    const links = page.locator(".web-header .nav__links > a:not(.nav__sheet-get), .web-header .nav__drop-link");
    await expect(links).toHaveText(entries);
    for (const [i, path] of paths.entries()) await expect(links.nth(i)).toHaveAttribute("href", `${pre}${path}`);
    await expect(links.nth(2)).toHaveAttribute("aria-current", "page");
    if (isMobile) {
      // In the sheet each menu is a group, open under its entry, and the sheet scrolls inside the screen.
      await expect(page.locator(".web-header .nav__menu-sections a")).toHaveCount(8);
      await expect(page.locator(".web-header .nav__menu-list--docs a")).toHaveCount(6);
      await expect(page.locator(".web-header .nav__cmp .nav__menu-list a").first()).toBeVisible();
      // Every group fits the screen's width.
      for (const card of await page.locator(".web-header .nav__menu-card").all()) {
        const box = await card.boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
      }
      const sheet = page.locator("#navLinks");
      const box = await sheet.boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
      expect(await sheet.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
      await toggle.click();
      await expect(page.locator(".web-header")).not.toHaveAttribute("data-open");
      return;
    }
    for (const width of [1440, 1280, 1100, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      const fits = await page.evaluate(() => {
        const bar = document.querySelector(".web-header .nav__in")?.getBoundingClientRect();
        const items = [...document.querySelectorAll(".web-header .nav__in > *")].map((el) =>
          el.getBoundingClientRect(),
        );
        return Boolean(bar) && items.every((r) => r.right <= innerWidth && r.height <= 64 && r.top >= (bar?.top ?? 0));
      });
      expect(fits, `header at ${width}px`).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(toggle).toBeVisible({ visible: width < 1000 });
    }
  });
}

for (const lang of ["en", "es"] as const) {
  const pre = lang === "es" ? "/es" : "";

  // Dropdowns open on hover from 1000 px.
  test(`${lang}: Product and Docs menus lead to the home's sections and the guide @desktop`, async ({
    page,
    request,
  }) => {
    await page.goto(`${pre}/compare/`);
    const product = page.locator(".web-header .nav__product .nav__menu");
    await page.locator(".nav__product .nav__drop-link").hover();
    await expect(product).toBeVisible();
    const sections = product.locator("a[data-section]");
    await expect(sections).toHaveCount(8);
    for (const link of await sections.all()) {
      const id = await link.getAttribute("data-section");
      await expect(link).toHaveAttribute("href", `${pre}/#${id}`);
      expect(await (await request.get(`${pre}/`)).text()).toContain(`id="${id}"`);
    }
    // Choosing one goes there and closes the menu.
    await sections.filter({ hasText: lang === "es" ? "Mapa de la guía" : "Docs map" }).click();
    await expect(page).toHaveURL(`${pre}/#map`);
    await expect(product).toBeHidden();
    await expect(page.locator('.nav__product a[data-section="map"]')).toHaveAttribute("aria-current", "location");
    // Docs: the start page as a card and one row per guide section, each a page in this language.
    const docs = page.locator(".web-header .nav__docs .nav__menu");
    await page.locator(".nav__docs .nav__drop-link").hover();
    await expect(docs).toBeVisible();
    await expect(docs.locator(".nav__feat")).toHaveAttribute("href", `${pre}/docs/start/introduction/`);
    const rows = docs.locator(".nav__menu-list a");
    await expect(rows).toHaveCount(6);
    for (const row of await rows.all()) {
      const href = (await row.getAttribute("href")) ?? "";
      expect(href).toMatch(new RegExp(`^${pre}/docs/[a-z-]+/[a-z-]+/$`));
      expect((await request.get(href)).status(), href).toBe(200);
      expect((await row.locator(".nav__menu-text span").textContent())?.trim().length).toBeGreaterThan(10);
    }
    // Menus stay inside the page at every width they show.
    for (const width of [1440, 1100, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ["product", "docs", "cmp"]) {
        await page.locator(`.nav__${name} .nav__drop-link`).hover();
        const box = await page.locator(`.nav__${name} .nav__menu-card`).boundingBox();
        expect(box?.x ?? -1, `${name} at ${width}`).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0), `${name} at ${width}`).toBeLessThanOrEqual(width);
      }
    }
  });
}
