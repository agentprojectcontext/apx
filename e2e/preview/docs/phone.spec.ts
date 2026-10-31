import { expect, test } from "@playwright/test";

// Runs only in the phone project (e2e/docs-comparisons.config.ts).

for (const path of [
  "/",
  "/es/",
  "/compare/",
  "/es/compare/openbot/",
  "/compare/best-ai-agent-apps/",
  "/es/compare/best-ai-agent-apps/",
]) {
  test(`${path}: every control is at least 44 px tall to tap and the page keeps the screen's width`, async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("apx-website-analytics-v1", "declined"));
    await page.goto(path);
    expect(await page.evaluate(() => innerWidth)).toBe(page.viewportSize()?.width);
    // Each control is probed 21 px above and below its centre: what a finger there would hit.
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const controls = [...document.querySelectorAll<HTMLElement>("a, button, summary")].filter((el) => {
        const box = el.getBoundingClientRect();
        return (
          box.width > 0 &&
          getComputedStyle(el).visibility !== "hidden" &&
          !el.closest("p, .row-sources, .skip-link, .marquee, details:not([open]) > :not(summary)")
        );
      });
      for (const el of controls) {
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const box = el.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hits = (dy: number) => {
          const target = document.elementFromPoint(x, y + dy);
          return Boolean(target && (target === el || el.contains(target)));
        };
        if (!hits(-21) || !hits(21))
          out.push(`${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}`);
      }
      return out;
    });
    expect(small).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const pre of ["", "/es"]) {
  test(`${pre || "en"}: the hero's download menu and install panel fit on the screen`, async ({ page }) => {
    await page.goto(`${pre}/`);
    const width = page.viewportSize()?.width ?? 0;
    await page.locator(".hero .getapx__more").tap();
    const menu = await page.locator(".hero .getapx__menu").boundingBox();
    expect(menu?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((menu?.x ?? 0) + (menu?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.locator(".hero .getapx__more").tap();
    await page.locator(".hero__term").tap();
    const panel = await page.locator("#heroInstall").boundingBox();
    expect(panel?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeLessThanOrEqual(width);
    for (const tab of ["unix", "win", "server"]) {
      await page.locator(`#heroInstall [data-term='${tab}']`).tap();
      await expect(page.locator(`#heroInstall [data-pane='${tab}']`)).toBeVisible();
    }
  });
}
