// The super-agent's profile lives in its own editor: the side panel's Profile row opens it there, a switch applies at
// once, and Settings has no super-agent section of its own.
import { expect, open, openSettings, rpc, test } from "./kit.ts";

type Listed = { active: { id: string | null }; routines: Array<{ origin?: string }> };

test.beforeAll(async () => {
  await rpc("setup.finish");
  await rpc("profiles.set", { id: null, values: {} });
});

test.afterAll(async () => {
  await rpc("profiles.set", { id: null, values: {} });
});

test("the Profile row opens the super-agent's editor on its profile, and a switch applies there", async ({ page }) => {
  await open(page);
  await page
    .getByRole("main")
    .getByRole("button", { name: /^Ver a / })
    .first()
    .click();
  const block = page.locator(".teamdetail.is-panel");
  await block.getByRole("button", { name: /Perfil: Ninguno/ }).click();

  const editor = page.getByRole("dialog", { name: "Editar super-agente" });
  await expect(editor.getByRole("heading", { name: "Perfil" })).toBeVisible();
  await expect(editor.getByText("Solo del super-agente", { exact: true })).toBeVisible();
  const nav = editor.getByRole("button", { name: /^Perfil/ });
  await expect(nav).toContainText("Ninguno");
  await expect(editor.getByRole("radio", { name: /Ninguno/ })).toBeChecked();
  await expect(editor.getByRole("button", { name: "Instalar perfil" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Abrir en Configuración" })).toHaveCount(0);

  await editor.getByRole("radio", { name: /Coach de foco/ }).click();
  await expect(editor.getByRole("radio", { name: /Coach de foco/ })).toBeChecked();
  await expect(nav).toContainText("Coach de foco");
  await expect(editor.getByText("Una cosa para hoy", { exact: true }).last()).toBeVisible();
  await expect.poll(async () => (await rpc<Listed>("profiles.list")).active.id).toBe("focus");
  // Applied without Save: nothing pending in the editor's draft.
  await expect(editor.getByRole("button", { name: "Descartar" })).toBeDisabled();
  // The block behind the modal follows too (out of the accessibility tree while the editor is open).
  await expect(block.locator(".teamdetail__superlink").first()).toContainText("Perfil: Coach de foco");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  // Settings has no super-agent section; Interruptions sits with the general settings.
  await openSettings(page);
  const config = page.getByRole("dialog", { name: "Configuración" });
  await expect(config.getByRole("button", { name: "Super-agente", exact: true })).toHaveCount(0);
  await expect(
    config.locator(".config__group", { hasText: "General" }).getByRole("button", { name: "Interrupciones" }),
  ).toBeVisible();
});

test("an agent that is not the super-agent has no profile page", async ({ page }) => {
  await rpc("agents.create", { slug: "northwind-clerk", name: "Northwind clerk", role: "Clerk" });
  await open(page, "#project=~default&tab=team");
  await page.locator(".teamcanvas__node", { hasText: "Northwind clerk" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const editor = page.getByRole("dialog", { name: "Editar a Northwind clerk" });
  await expect(editor.getByRole("button", { name: "Identidad" })).toBeVisible();
  await expect(editor.getByRole("button", { name: /^Perfil/ })).toHaveCount(0);
});
