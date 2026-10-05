// The ChatGPT plan as a model for APX's own loop: a card under Engines that is not connected until the owner signs in.
import { expect, open, rpc, test } from "./kit.ts";

test("the ChatGPT plan shows as a provider to connect, with its own sign-in (not Codex's)", async ({ page }) => {
  await rpc("setup.finish", {});
  const status = await rpc<{ connected: boolean }>("chatgpt.status");
  expect(status.connected).toBe(false);
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const box = page.getByRole("combobox", { name: "Buscar" }).or(page.getByRole("textbox", { name: "Buscar" }));
  await box.fill("motores y modelos");
  await page.getByRole("option", { name: /Motores y modelos/ }).click();
  const settings = page.getByRole("dialog", { name: "Configuración" });
  const card = settings.locator(".pcard", { hasText: "ChatGPT (tu plan)" });
  await expect(card).toContainText("Sin conectar");
  await card.getByRole("button", { name: "Conectar" }).click();
  const signIn = page.getByRole("dialog", { name: "ChatGPT para el loop de APX" });
  await expect(signIn).toContainText("no la app de Codex");
  await expect(signIn.getByRole("button", { name: "Conectar con un código" })).toBeVisible();
});
