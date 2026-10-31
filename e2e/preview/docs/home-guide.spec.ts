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
    await expect(terminal.locator(".sec-label")).toContainText("05");
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

test("the terminal demo plays its commands in turn, and keeps its size", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const screen = page.locator("#terminal .term-demo__screen");
  await page.evaluate(() => document.fonts.ready);
  await screen.scrollIntoViewIfNeeded();
  await expect(screen).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#terminal .visually-hidden")).toContainText("apx status");
  // Layout height, not the box on screen: blocks rise in scaled while they appear.
  const height = () => screen.evaluate((el) => (el as HTMLElement).offsetHeight);
  const before = await height();
  await expect(screen).toContainText("apx tasks --project acme-store", { timeout: 25_000 });
  expect(await height()).toBe(before);
});

test("with reduced motion the terminal demo shows its first command, still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/es/");
  const screen = page.locator("#terminal .term-demo__screen");
  await expect(screen).toContainText('apx chat "¿Qué tengo para hoy?"');
  await expect(screen).toContainText("Nada vence hoy.");
  await page.waitForTimeout(3000);
  await expect(screen).not.toContainText("apx tasks");
});

for (const pre of ["", "/es"]) {
  test(`${pre || "en"}: downloads offer one install line at a time, the server guide and the unsigned-apps steps`, async ({
    page,
    request,
  }) => {
    await page.goto(`${pre}/`);
    const box = page.locator("#download .cli");
    const panes = box.locator("[data-cli-pane]:visible");
    await expect(panes).toHaveCount(1);
    for (const [id, cmd] of [
      ["server", "curl -fsSL https://apxagent.app/install.sh | bash -s -- --server"],
      ["unix", "curl -fsSL https://apxagent.app/install.sh | bash"],
      ["win", "irm https://apxagent.app/install.ps1 | iex"],
    ] as const) {
      await box.locator(`[data-cli='${id}']`).click();
      await expect(box.locator(`[data-cli='${id}']`)).toHaveAttribute("aria-pressed", "true");
      await expect(panes).toHaveCount(1);
      await expect(box.locator(`[data-cli-pane='${id}'] code`)).toHaveText(
        new RegExp(`${cmd.replace(/[|.]/g, "\\$&")}$`),
      );
    }
    const server = page.locator("#download .dl-server");
    await expect(server.locator(".dl-server__cta")).toHaveAttribute("href", `${pre}/docs/devices/server/`);
    for (const href of await server
      .locator("a")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
      if (href.startsWith("http")) continue;
      expect((await request.get(href.split("#")[0] ?? "")).status(), href).toBe(200);
    }
    const unsigned = page.locator("#download .dl-unsigned");
    await expect(unsigned).toBeVisible();
    await expect(unsigned).toContainText("xattr -dr com.apple.quarantine /Applications/APX.app");
    await expect(unsigned.locator("dt")).toHaveCount(4);
  });
}
