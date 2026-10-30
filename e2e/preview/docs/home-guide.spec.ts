import { expect, test } from "@playwright/test";

for (const lang of ["en", "es"] as const) {
  const pre = lang === "es" ? "/es" : "";

  test(`${lang}: the docs map and the terminal demo lead into the docs`, async ({ page, request }) => {
    await page.goto(`${pre}/`);
    const map = page.locator("#map");
    await expect(map.locator(".sec-label")).toContainText("04");
    await expect(map.locator(".guide-card")).toHaveCount(7);
    const hrefs = await map.locator(".guide-card a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThanOrEqual(21);
    for (const href of hrefs) {
      expect(href, "a documentation page in this language").toMatch(
        new RegExp(`^${pre}/docs/[a-z-]+/[a-z0-9-]+/(#[a-z0-9-]+)?$`),
      );
      expect((await request.get(href ?? "")).status(), href ?? "").toBe(200);
    }
    const terminal = page.locator("#terminal");
    await expect(terminal.locator(".sec-label")).toContainText("06");
    await expect(terminal.locator(".term-demo__screen")).toContainText(
      lang === "es" ? 'apx chat "¿Qué tengo para hoy?"' : 'apx chat "What\'s on my plate today?"',
    );
    await expect(terminal.locator(".term-demo__screen")).toContainText(
      lang === "es" ? "Nada vence hoy." : "Nothing is due today.",
    );
    const all = terminal.getByRole("link", { name: lang === "es" ? "Todos los comandos →" : "Every command →" });
    await expect(all).toHaveAttribute("href", `${pre}/docs/reference/cli/`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await all.click();
    await expect(page).toHaveURL(`${pre}/docs/reference/cli/`);
    await expect(page.locator("main h1")).toBeVisible();
  });
}
