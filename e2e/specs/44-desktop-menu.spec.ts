// Inside the desktop app on Windows and Linux the window shows no menu bar: the account menu carries the app menu's
// About, updates and connection items. Here the desktop bridge is a stand-in that says it is Windows.
import { expect, test } from "./kit.ts";

test("on Windows the account menu runs the desktop app's About, updates and change connection", async ({ page }) => {
  await page.addInitScript(() => {
    const ran: string[] = [];
    Object.assign(window, {
      ran,
      apxDesktop: { platform: "win32", setBrowserBounds() {}, menuAction: (id: string) => ran.push(id) },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Acerca de APX" }).click();
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Buscar actualizaciones…" }).click();
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Cambiar conexión…" }).click();
  expect(await page.evaluate(() => (window as unknown as { ran: string[] }).ran)).toEqual([
    "about",
    "update",
    "change-connection",
  ]);
});

test("in a browser the account menu has no desktop app items", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await expect(page.getByRole("menuitem", { name: "Configuración inicial" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Acerca de APX" })).toHaveCount(0);
});
