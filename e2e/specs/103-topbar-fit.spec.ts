import { expect, open, rpc, test } from "./kit.ts";

test("topbar preserves counters and quotas until its actual controls no longer fit", async ({ page }) => {
  await rpc("setup.finish");
  await page.route("**/rpc/engines.usage", (route) =>
    route.fulfill({
      json: {
        ok: true,
        result: {
          checked_at: "2026-01-01T12:00:00.000Z",
          engines: ["codex", "claude"].map((id) => ({
            id,
            label: id,
            cli_installed: true,
            available: true,
            status: "ok",
            source: "codex_app_server",
            windows: [{ id: "primary", used_percent: 37, window_minutes: 300 }],
          })),
        },
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const right = page.locator(".topbar__right");
  const quota = page.getByTestId("engine-usage-quick").first();
  const counters = page.locator(".running__count.is-light").first();
  await expect(quota).toBeVisible();
  await expect(counters).toBeVisible();
  await expect(right).toHaveAttribute("data-fit", "0");
  await expect(page.getByTestId("engine-usage-button")).toHaveAccessibleName("Cuotas de IA");
  await expect(page.getByTestId("usage-button")).toHaveAccessibleName(/Sistema|Recursos del sistema/);

  // Opening a menu must not count its invisible focus guards as overflowing controls.
  await page.locator(".topbar__agent").click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(right).toHaveAttribute("data-fit", "0");
  await expect(quota).toBeVisible();
  await page.keyboard.press("Escape");

  for (const width of [1040, 1440, 1040, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 1040) {
      await expect(right).toHaveAttribute("data-fit", "4");
      await expect(quota).toBeHidden();
      await expect(counters).toBeHidden();
      await expect(page.locator(".topbar__agentname")).toBeHidden();
      await expect(page.locator(".usage-btn__gauge")).toBeHidden();
      await expect(page.locator(".usage-btn__pct")).toBeVisible();
      await expect(page.getByTestId("engine-usage-button")).toBeVisible();
      await expect(page.locator(".topbar__activity .running")).toBeVisible();
    } else {
      await expect(right).toHaveAttribute("data-fit", "0");
      await expect(quota).toBeVisible();
      await expect(counters).toBeVisible();
      await expect(page.locator(".topbar__agentname")).toBeVisible();
      await expect(page.locator(".usage-btn__gauge")).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // The same viewport can need a compact layout when native controls occupy the right edge.
  await right.evaluate((row) => {
    row.style.paddingRight = "330px";
  });
  await expect(quota).toBeHidden();
  await expect(right).not.toHaveAttribute("data-fit", "0");
  await right.evaluate((row) => {
    row.style.paddingRight = "";
  });
  await expect(quota).toBeVisible();
  await expect(counters).toBeVisible();
  await expect(right).toHaveAttribute("data-fit", "0");

  // Content changes, not just a viewport resize, must trigger a fresh fit in both directions.
  await page.locator(".topbar__agentname").evaluate((name) => {
    name.textContent = "A".repeat(160);
  });
  await expect(page.locator(".topbar__agentname")).toBeHidden();
  await expect(quota).toBeVisible();
  await expect(counters).toBeVisible();
  await page.locator(".topbar__agentname").evaluate((name) => {
    name.textContent = "Acme";
  });
  await expect(right).toHaveAttribute("data-fit", "0");
  await expect(page.locator(".topbar__agentname")).toBeVisible();
});
