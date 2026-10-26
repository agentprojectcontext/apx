import { expect, open, rpc, test } from "./kit.ts";

const report = {
  checked_at: "2026-01-01T12:00:00.000Z",
  engines: [
    {
      id: "codex",
      label: "Codex",
      cli_installed: true,
      available: true,
      status: "ok",
      source: "codex_app_server",
      windows: [
        { id: "primary", used_percent: 37, window_minutes: 300, resets_at: "2026-01-01T17:00:00.000Z" },
        { id: "secondary", used_percent: 91, window_minutes: 10080 },
      ],
    },
    {
      id: "claude",
      label: "Claude",
      cli_installed: true,
      available: false,
      status: "unavailable",
      source: "none",
      reason: "unsupported",
      windows: [],
    },
    {
      id: "opencode",
      label: "OpenCode",
      cli_installed: true,
      available: false,
      status: "unavailable",
      source: "none",
      reason: "unsupported",
      windows: [],
    },
    {
      id: "antigravity",
      label: "Antigravity",
      cli_installed: false,
      available: false,
      status: "unavailable",
      source: "none",
      reason: "cli_not_found",
      windows: [],
    },
  ],
};

test("AI usage shows account windows, unavailable engines and a narrow-screen access", async ({ page }) => {
  await rpc("setup.finish");
  let calls = 0;
  await page.route("**/rpc/engines.usage", async (route) => {
    calls++;
    await route.fulfill({ json: { ok: true, result: report } });
  });
  await open(page);
  expect(calls).toBe(0);
  const trigger = page.getByTestId("engine-usage-button");
  const bounds = await trigger.evaluate((button) => {
    const label = button.querySelector("span")?.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    return { labelRight: label?.right ?? Infinity, right: rect.right };
  });
  expect(bounds.labelRight).toBeLessThanOrEqual(bounds.right);
  await trigger.click();
  const summary = page.getByTestId("engine-usage-summary");
  await expect(summary.getByText("63% disponible")).toBeVisible();
  await expect(summary.getByText("9% disponible")).toBeVisible();
  await expect(summary.getByText("5 horas", { exact: true })).toBeVisible();
  await expect(summary.getByText("Semanal", { exact: true })).toBeVisible();
  await expect(summary.getByRole("img", { name: "Codex · 5 horas: 37% usado" })).toBeVisible();
  await expect(summary.getByText(/Se renueva/)).toBeVisible();
  const claude = summary.locator("section").filter({ has: page.getByRole("heading", { name: "Claude", exact: true }) });
  await expect(claude.locator(".apx-meter")).toHaveCount(0);
  await expect(claude).toContainText("Sin fuente de cuota compatible");
  await expect(summary.getByText(/Sin datos no significa consumo ilimitado/)).toHaveCount(0);
  await summary.getByRole("button", { name: "Ayuda sobre cuotas de IA", exact: true }).click();
  await expect(page.locator(".apx-help__panel")).toContainText("Sin datos no significa consumo ilimitado");
  await page.keyboard.press("Escape");
  const beforeRefresh = calls;
  await summary.getByRole("button", { name: "Actualizar" }).click();
  await expect.poll(() => calls).toBe(beforeRefresh + 1);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("engine-usage-button")).toBeVisible();
  await page.getByTestId("engine-usage-button").click();
  await expect(summary.getByText("63% disponible")).toBeVisible();
  await summary.getByRole("button", { name: "Administrar engines" }).click();
  await expect(summary).toHaveCount(0);
});

test("Claude displays real account windows and its CLI source", async ({ page }) => {
  await rpc("setup.finish");
  await page.route("**/rpc/engines.usage", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        result: {
          ...report,
          engines: [
            {
              id: "claude",
              label: "Claude",
              cli_installed: true,
              available: true,
              status: "ok",
              source: "claude_cli",
              windows: [
                { id: "primary", used_percent: 15, window_minutes: 300 },
                { id: "secondary", used_percent: 87, window_minutes: 10080 },
              ],
            },
          ],
        },
      },
    });
  });
  await open(page);
  await page.getByTestId("engine-usage-button").click();
  const summary = page.getByTestId("engine-usage-summary");
  await expect(summary.getByText("85% disponible")).toBeVisible();
  await expect(summary.getByText("13% disponible")).toBeVisible();
  await expect(summary.getByRole("img", { name: "Claude · Semanal: 87% usado" })).toBeVisible();
  await expect(summary.getByText("Fuente: cuota del plan de Claude (/usage)")).toHaveCount(0);
  const help = summary.getByRole("button", { name: "Ayuda sobre cuotas de Claude", exact: true });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".apx-help__panel")).toContainText("Fuente: cuota del plan de Claude (/usage)");
  await expect(page.locator(".apx-help__panel")).not.toContainText("Sin fuente de cuota compatible");
  await page.keyboard.press("Escape");
  await expect(summary.getByText("85% disponible")).toBeVisible();
});

test("AI usage recovers from a failed request without showing an invented balance", async ({ page }) => {
  await rpc("setup.finish");
  let fail = true;
  await page.route("**/rpc/engines.usage", async (route) => {
    await route.fulfill({
      json: fail
        ? { ok: false, error: { code: "unavailable", message: "Not available" } }
        : { ok: true, result: report },
    });
  });
  await open(page);
  await page.getByTestId("engine-usage-button").click();
  const summary = page.getByTestId("engine-usage-summary");
  await expect(summary.getByRole("alert")).toContainText("Volvé a intentar");
  await expect(summary.locator(".apx-meter")).toHaveCount(0);
  fail = false;
  await summary.getByRole("button", { name: "Actualizar" }).click();
  await expect(summary.getByText("63% disponible")).toBeVisible();
});
