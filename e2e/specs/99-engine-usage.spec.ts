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
  await expect(claude.getByRole("img")).toHaveCount(0);
  await expect(claude).toContainText("Sin fuente de cuota compatible");
  await expect(summary).toContainText("Sin datos no significa consumo ilimitado");
  await summary.getByRole("button", { name: "Actualizar" }).click();
  await expect.poll(() => calls).toBe(2);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("engine-usage-button")).toBeVisible();
  await page.getByTestId("engine-usage-button").click();
  await expect(summary.getByText("63% disponible")).toBeVisible();
  await summary.getByRole("button", { name: "Administrar engines" }).click();
  await expect(summary).toHaveCount(0);
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
