// Account: the owner picks their agents' language and their time zone from searchable lists; Advanced says in words
// what each part of the core is doing and keeps the outside apps' tokens.
import { expect, open, rpc, test } from "./kit.ts";

type Owner = { language: string; timezone: string };

test("time zone and language are picked by searching, and Advanced names each part of the core", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("cuenta");
  await page.getByRole("option", { name: /Cuenta/ }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });

  await dialog.getByRole("combobox", { name: "Zona horaria" }).click();
  await page.getByPlaceholder("Buscá una ciudad o país").fill("madrid");
  await page.getByRole("option", { name: /Madrid/ }).click();
  await expect.poll(async () => (await rpc<Owner>("owner.get")).timezone).toBe("Europe/Madrid");

  await dialog.getByRole("combobox", { name: "Idioma de tus agentes" }).click();
  await page.getByPlaceholder("Buscá un idioma").fill("portu");
  await page.getByRole("option", { name: /Português/ }).click();
  await expect.poll(async () => (await rpc<Owner>("owner.get")).language).toBe("pt");
  await rpc("owner.set", { language: "es", timezone: "" });

  await dialog.getByRole("button", { name: /^Avanzado/ }).click();
  await expect(dialog.getByText("Conexión con las apps")).toBeVisible();
  await expect(dialog.getByText("Conectar otras apps de IA")).toBeVisible();
});
