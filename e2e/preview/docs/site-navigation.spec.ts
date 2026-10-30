import { expect, test } from "@playwright/test";

for (const lang of ["en", "es"]) {
  const pre = lang === "es" ? "/es" : "";
  test(`${lang}: shared web navigation, footer, theme and matching language page`, async ({ page }, testInfo) => {
    await page.goto(`${pre}/`);
    const header = await page.locator(".web-header").innerText();
    const footer = await page.locator(".web-footer").innerText();
    await page.locator('.web-header a[href$="/compare/"]').click();
    await expect(page).toHaveURL(`${pre}/compare/`);
    expect(await page.locator(".web-header").innerText()).toBe(header);
    expect(await page.locator(".web-footer").innerText()).toBe(footer);
    await page.locator('.comparison-card[href$="/openclaw/"]').click();
    expect(await page.locator(".web-header").innerText()).toBe(header);
    expect(await page.locator(".web-footer").innerText()).toBe(footer);
    const before = await page.locator("html").getAttribute("data-theme");
    await page.locator("#theme").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", before === "light" ? "dark" : "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", before === "light" ? "dark" : "light");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("web-header.png") });
    await page.locator(".web-footer").scrollIntoViewIfNeeded();
    if ((page.viewportSize()?.width ?? 0) >= 1200) await expect(page.locator(".reading-rail")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("web-footer.png") });
    await page.locator('.web-footer a[href$="/docs/start/introduction/"]').click();
    await expect(page).toHaveURL(`${pre}/docs/start/introduction/`);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://apxagent.app${pre}/docs/start/introduction/`,
    );
    await expect(page.locator("nav.sidebar a[href*='/docs/']").first()).toBeAttached();
  });

  test(`${lang}: every shared web footer exposes the official YouTube channel`, async ({ page }, testInfo) => {
    const destination = "https://www.youtube.com/@apx-agents";
    for (const path of ["/", "/compare/", "/compare/hermes-agent/", "/compare/openclaw/", "/compare/openbot/"]) {
      await page.goto(`${pre}${path}`);
      const community = page
        .locator(".web-footer")
        .getByRole("navigation", { name: lang === "es" ? "APX en redes" : "APX on social media", exact: true });
      const youtube = community.getByRole("link", { name: "YouTube", exact: true });
      await expect(youtube).toHaveCount(1);
      await expect(youtube).toHaveAttribute("href", destination);
      await youtube.scrollIntoViewIfNeeded();
      await expect(youtube).toBeVisible();
      await youtube.focus();
      await expect(youtube).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (path === "/") await page.screenshot({ path: testInfo.outputPath("youtube-community.png") });
    }
    await page.route(destination, (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>External navigation target</title>" }),
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(destination);
  });

  test(`${lang}: branded footer remains accessible in both themes`, async ({ page, isMobile }, testInfo) => {
    for (const theme of ["light", "dark"]) {
      await page.addInitScript((value) => localStorage.setItem("starlight-theme", value), theme);
      for (const path of ["/", "/compare/hermes-agent/"]) {
        await page.goto(`${pre}${path}`);
        const footer = page.locator(".web-footer");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(footer.locator(".brand")).toHaveText("APX");
        await expect(footer.locator(".web-footer__origin")).toHaveText(
          lang === "es" ? "Hecho con ♥ en Argentina" : "Made with ♥ in Argentina",
        );
        const platforms = footer.getByRole("list", {
          name: lang === "es" ? "Plataformas disponibles" : "Available platforms",
        });
        await expect(platforms.getByRole("listitem")).toHaveText(["macOS", "Windows", "Linux", "Android"]);
        await expect(footer.locator(".web-footer__groups nav")).toHaveCount(4);
        const layout = await footer.evaluate((element) => {
          const bounds = (selector: string) => {
            const rect = element.querySelector(selector)?.getBoundingClientRect();
            return { x: rect?.x ?? 0, y: rect?.y ?? 0, bottom: rect?.bottom ?? 0 };
          };
          return {
            main: bounds(".web-footer__main"),
            availability: bounds(".web-footer__availability"),
            origin: bounds(".web-footer__origin"),
            brand: bounds(".web-footer__intro"),
            columns: [...element.querySelectorAll(".web-footer__groups nav")].map(
              (nav) => nav.getBoundingClientRect().y,
            ),
          };
        });
        expect(layout.availability.y).toBeGreaterThanOrEqual(layout.main.bottom);
        expect(layout.origin.y).toBeGreaterThanOrEqual(layout.main.bottom);
        if (!isMobile) {
          expect(new Set(layout.columns).size).toBe(1);
          expect(layout.columns[0]).toBeLessThan(layout.brand.bottom);
          expect(Math.abs(layout.origin.y - layout.availability.y)).toBeLessThan(1);
        }
        for (const [name, url] of [
          ["GitHub", "https://github.com/agentprojectcontext/apx"],
          ["Discord", "https://discord.gg/vxdZuT5WuE"],
          ["YouTube", "https://www.youtube.com/@apx-agents"],
        ] as const) {
          const link = footer.getByRole("link", { name, exact: true });
          await expect(link).toHaveAttribute("href", url);
          await expect(link.locator("svg")).toHaveAttribute("aria-hidden", "true");
          await link.scrollIntoViewIfNeeded();
          await link.focus();
          await expect(link).toBeFocused();
          expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
          const box = await link.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(44);
        }
        const contrast = await footer.locator(".web-footer__description").evaluate((element) => {
          const luminance = (color: string) => {
            const c = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
              const value = Number(part) / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return (c[0] ?? 0) * 0.2126 + (c[1] ?? 0) * 0.7152 + (c[2] ?? 0) * 0.0722;
          };
          const a = luminance(getComputedStyle(element).color);
          const b = luminance(getComputedStyle(element.closest("footer") as HTMLElement).backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await footer.screenshot({
          path: testInfo.outputPath(`footer-${theme}-${path === "/" ? "home" : "comparison"}.png`),
          style: ".web-header { visibility: hidden; }",
        });
      }
    }
  });

  test(`${lang}: old documentation URLs preserve query and fragment`, async ({ page }) => {
    await page.goto(`${pre}/start/introduction/?from=legacy#_top`);
    await expect(page).toHaveURL(`${pre}/docs/start/introduction/?from=legacy#_top`);
    await expect(page.locator("main h1")).toBeVisible();
    await page.goto(`${pre}/docs/`);
    await expect(page).toHaveURL(`${pre}/docs/start/introduction/`);
  });

  test(`${lang}: documentation language switch, search and installer`, async ({ page, request, isMobile }) => {
    await page.goto(`${pre}/docs/start/introduction/`);
    if (isMobile) await page.getByRole("button", { name: lang === "es" ? "Menú" : "Menu", exact: true }).click();
    const selector = page.locator("starlight-lang-select select:visible").first();
    await selector.selectOption(`${lang === "es" ? "" : "/es"}/docs/start/introduction/`);
    await expect(page).toHaveURL(`${lang === "es" ? "" : "/es"}/docs/start/introduction/`);
    await page.locator("site-search button[data-open-modal]").click();
    await page.getByRole("dialog").getByRole("textbox").fill("APX");
    await expect(page.locator(".pagefind-ui__result-link").first()).toBeVisible();
    await expect(page.locator(".pagefind-ui__result-link").first()).toHaveAttribute("href", /\/docs\//);
    await page.locator(".pagefind-ui__result-link").first().click();
    await expect(page.locator("main h1")).toBeVisible();
    for (const file of ["install.sh", "install.ps1"]) {
      const result = await request.get(`/${file}`);
      expect(result.status()).toBe(200);
      expect((await result.body()).length).toBeGreaterThan(1000);
    }
  });
}
