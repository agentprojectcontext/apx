// The frame: the sidebar and the list fold and come back, the list is resized from the keyboard, the language switches
// with no key left untranslated, and Settings opens every section.
import { expect, open, test } from "./kit.ts";

test("the sidebar and the chat list fold and unfold", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Plegar la lista" }).click();
  await expect(page.getByRole("searchbox").first()).toBeHidden();
  await page.getByRole("button", { name: /Desplegar la lista|Mostrar la lista/ }).click();
  await expect(page.getByRole("searchbox").first()).toBeVisible();

  const handle = page.getByRole("separator", { name: "Cambiar el ancho de la lista" });
  const before = await handle.getAttribute("aria-valuenow");
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(await handle.getAttribute("aria-valuenow")).not.toBe(before);
});

test("English and Spanish show text, never a raw key", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Idioma/ }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\b[a-z]+\.[a-z]+\.[a-zA-Z.]+\b/);
  await page.getByRole("button", { name: /^Language/ }).click();
  await page.getByRole("menuitem", { name: "Español" }).click();
  await expect(page.getByRole("button", { name: "Tareas" })).toBeVisible();
});

test("Settings opens each section", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Config", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const sections = dialog.getByRole("navigation").getByRole("button");
  const n = await sections.count();
  expect(n).toBeGreaterThan(4);
  for (let i = 0; i < n; i++) await sections.nth(i).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
