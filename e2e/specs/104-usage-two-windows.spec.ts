import { expect, open, rpc, test } from "./kit.ts";

const claude = () => ({
  checked_at: new Date().toISOString(),
  engines: [
    {
      id: "claude",
      label: "Claude",
      cli_installed: true,
      available: true,
      status: "ok",
      source: "claude_cli",
      windows: [
        {
          id: "primary",
          used_percent: 15,
          window_minutes: 300,
          resets_at: new Date(Date.now() + 130 * 60_000).toISOString(),
        },
        {
          id: "secondary",
          used_percent: 87,
          window_minutes: 10080,
          resets_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
        },
      ],
    },
  ],
});

test("a plan with two limits shows the tightest one and lists both", async ({ page }, info) => {
  await rpc("setup.finish");
  await page.route("**/rpc/engines.usage", (route) => route.fulfill({ json: { ok: true, result: claude() } }));
  await open(page);
  const trigger = page.getByTestId("engine-usage-button");
  await expect(trigger.getByTestId("engine-usage-quick")).toHaveText("13%");
  await trigger.hover();
  const tip = page.locator(".engine-usage-tip");
  await expect(tip).toContainText("Claude · Sesión (5 h) · 85% disponible · Se reinicia en 2 h");
  await expect(tip).toContainText("Claude · Semanal · 13% disponible · Se reinicia el");
  await page.screenshot({ path: info.outputPath("desktop-hover.png") });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  const summary = page.getByTestId("engine-usage-summary");
  await expect(summary.getByText("Sesión (5 h)", { exact: true })).toBeVisible();
  await expect(summary.getByText("Semanal", { exact: true })).toBeVisible();
  await expect(summary.getByText(/Se reinicia en 2 h/)).toBeVisible();
  await expect(summary.getByText(/Se reinicia el/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("phone-tap.png") });
});

test("a plan with one limit looks as before", async ({ page }) => {
  await rpc("setup.finish");
  const full = claude();
  const one = { ...full, engines: full.engines.map((engine) => ({ ...engine, windows: engine.windows.slice(0, 1) })) };
  await page.route("**/rpc/engines.usage", (route) => route.fulfill({ json: { ok: true, result: one } }));
  await open(page);
  const trigger = page.getByTestId("engine-usage-button");
  await expect(trigger.getByTestId("engine-usage-quick")).toHaveText("85%");
  await trigger.hover();
  await expect(page.locator(".engine-usage-tip")).not.toContainText("Semanal");
});
