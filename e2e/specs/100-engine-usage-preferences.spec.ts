import { expect, open, openSettings, rpc, test } from "./kit.ts";

test("usage switches persist independently of model power and preserve the choice after a failed save", async ({
  page,
}) => {
  await rpc("setup.finish");
  await rpc("engines.set_usage", { engine: "codex", enabled: false });
  await open(page);
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Configuración", exact: true });
  await settings.getByRole("button", { name: "Motores y modelos", exact: true }).click();
  const plan = settings.locator(".pcard--plan");
  const quota = plan.getByRole("switch", { name: "Consumo", exact: true });
  const power = plan.getByRole("switch", { name: "Activo", exact: true });
  await expect(quota).toBeEnabled();
  await expect(quota).not.toBeChecked();
  const powered = await power.isChecked();
  const height = await plan.evaluate((card) => card.getBoundingClientRect().height);
  await quota.click();
  await expect(quota).toBeChecked();
  expect(await power.isChecked()).toBe(powered);
  const prefs = await rpc<{ engines: Record<string, boolean> }>("engines.usage_preferences");
  expect(prefs.engines.codex).toBe(true);
  expect(await plan.evaluate((card) => card.getBoundingClientRect().height)).toBe(height);

  await page.reload();
  await openSettings(page);
  await settings.getByRole("button", { name: "Motores y modelos", exact: true }).click();
  await expect(quota).toBeChecked();
  await page.route("**/rpc/engines.set_usage", (route) =>
    route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Not available" } } }),
  );
  await quota.click();
  await expect(
    page.getByText("No se pudo guardar la preferencia de consumo. Se mantuvo tu elección anterior."),
  ).toBeVisible();
  await expect(quota).toBeChecked();
  await page.unroute("**/rpc/engines.set_usage");
  await quota.focus();
  await page.keyboard.press("Space");
  await expect(quota).not.toBeChecked();
  await expect(power).toBeChecked({ checked: powered });

  await settings.getByRole("button", { name: "Sesiones externas", exact: true }).click();
  const claude = settings.locator(".engine", { hasText: "Claude Code" });
  await expect(claude.getByRole("switch", { name: "Consumo", exact: true })).not.toBeChecked();
  await claude.getByRole("switch", { name: "Consumo", exact: true }).hover();
  await expect(page.locator(".apx-tooltip")).toBeVisible();
  await expect(page.locator(".apx-tooltip")).toContainText("No enciende ni apaga el engine");
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(claude.getByRole("switch", { name: "Consumo", exact: true })).toBeVisible();
  const overflow = await claude.evaluate((card) => card.scrollWidth - card.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the real usage method returns an empty state when all quota sources are off", async ({ page }) => {
  for (const engine of ["codex", "claude", "opencode", "antigravity"])
    await rpc("engines.set_usage", { engine, enabled: false });
  await open(page);
  await page.getByTestId("engine-usage-button").click();
  const summary = page.getByTestId("engine-usage-summary");
  await expect(summary).toContainText("No hay engines seleccionados");
  await expect(summary.locator(".apx-meter")).toHaveCount(0);
  await expect(summary.getByRole("button", { name: "Administrar engines" })).toBeVisible();
});
