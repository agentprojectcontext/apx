// ⌘K: one box to jump anywhere — a project, a task, a place of the app — by keyboard, accents or not.
import { expect, open, test } from "./kit.ts";

test("⌘K finds a project, a task and a settings section, and Enter goes there", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const box = page.getByRole("combobox", { name: "Buscar" }).or(page.getByRole("textbox", { name: "Buscar" }));
  await expect(box).toBeFocused();

  await box.fill("northw");
  await expect(page.getByRole("option", { name: /Northwind/ }).first()).toBeVisible();
  await box.press("Enter");
  await expect(page.getByRole("heading", { name: "Northwind" })).toBeVisible();

  await page.getByRole("button", { name: "Buscar o saltar a…" }).click();
  await box.fill("invoice");
  await expect(page.getByRole("option", { name: /Ship the invoice page/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();

  // Accents do not matter: "configuracion" finds the settings sections.
  await page.keyboard.press("ControlOrMeta+k");
  await box.fill("canales configuracion");
  await page.getByRole("option", { name: /Canales/ }).click();
  await expect(page.getByRole("dialog", { name: "Configuración" })).toBeVisible();
});
