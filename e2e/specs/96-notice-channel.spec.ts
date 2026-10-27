// The app always tells the owner; a chat app for notices is optional, and "none" keeps them in the app only.
import { expect, open, rpc, test } from "./kit.ts";

type Prefs = { channel?: string };

test("the owner keeps the super-agent's notices in the app only", async ({ page }) => {
  const before = await rpc<Prefs>("notices.get");
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("perfil");
  await page
    .getByRole("option", { name: /^Perfil/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(dialog.getByText(/La app, en esta compu y en tu teléfono, siempre te avisa/)).toBeVisible();
  const where = dialog.getByRole("combobox", { name: "Por dónde te habla" });
  await where.click();
  await expect(page.getByRole("option", { name: /\(push\)/ })).toHaveCount(0);
  await page.getByRole("option", { name: "Ninguno, solo en la app" }).click();
  await expect(where).toContainText("Ninguno, solo en la app");
  await expect.poll(async () => (await rpc<Prefs>("notices.get")).channel).toBe("none");
  await rpc("notices.set", before);
});
