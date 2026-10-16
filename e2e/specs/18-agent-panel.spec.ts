// The agent a chat is with opens beside it from its face or name: its block with the prompt and, for the super-agent,
// its profile and what it knows about the owner (Account), which the agents read too.
import { expect, open, rpc, test } from "./kit.ts";

// Done with the setup wizard: this spec must not depend on an earlier one having finished it.
test.beforeAll(async () => {
  await rpc("setup.finish");
});

test("the super-agent's face opens its block beside the chat; its prompt and profile are one click away", async ({
  page,
}) => {
  await rpc("owner.set", { about: "Runs a bakery in Northwind.", timezone: "America/Argentina/Buenos_Aires" });
  await open(page);
  const main = page.getByRole("main");
  await main
    .getByRole("button", { name: /^Ver a / })
    .first()
    .click();
  const block = page.locator(".teamdetail.is-panel");
  await expect(block).toBeVisible();
  await expect(block.getByRole("button", { name: /Perfil: Ninguno/ })).toBeVisible();
  await block.getByRole("tab", { name: "Prompt" }).click();

  await block.getByRole("button", { name: "Editar prompt" }).click();
  // The super-agent's own editor: what it is, no role, area or description, and its prompt adds to its role.
  const editor = page.getByRole("dialog", { name: "Editar super-agente" });
  await editor.getByRole("button", { name: "Identidad" }).click();
  await expect(editor.getByText(/El agente principal de APX/)).toBeVisible();
  await expect(editor.getByLabel("Nombre")).toBeVisible();
  await expect(editor.getByLabel("Rol")).toHaveCount(0);
  await expect(editor.getByLabel("Área")).toHaveCount(0);
  await expect(editor.getByLabel("Descripción")).toHaveCount(0);
  await editor.getByRole("button", { name: "Prompt" }).click();
  await editor.getByRole("textbox", { name: "Instrucciones extra" }).fill("Sign every message with a lemon.");
  await editor.getByRole("button", { name: "Guardar" }).click();
  await expect(block.getByText("Sign every message with a lemon.")).toBeVisible();

  await block.getByRole("button", { name: /Lo que sabe de vos/ }).click();
  const config = page.getByRole("dialog", { name: "Configuración" });
  await expect(config.getByRole("textbox", { name: "Sobre vos" })).toHaveValue("Runs a bakery in Northwind.");
  await expect(config.getByRole("combobox", { name: "Zona horaria" })).toHaveText(/Buenos Aires/);
});
