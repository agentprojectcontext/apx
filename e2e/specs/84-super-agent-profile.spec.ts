// The super-agent's profile is also in its own editor: the same picker as Settings › Super-agent, applied at once,
// and the agent's block and Settings follow the switch.
import { expect, open, rpc, test } from "./kit.ts";

type Listed = { active: { id: string | null }; routines: Array<{ origin?: string }> };

test.beforeAll(async () => {
  await rpc("setup.finish");
  await rpc("profiles.set", { id: null, values: {} });
});

test.afterAll(async () => {
  await rpc("profiles.set", { id: null, values: {} });
});

test("the super-agent's editor shows its profile, switches it, and Settings reflects the switch", async ({ page }) => {
  await open(page);
  await page
    .getByRole("main")
    .getByRole("button", { name: /^Ver a / })
    .first()
    .click();
  const block = page.locator(".teamdetail.is-panel");
  await expect(block.getByRole("button", { name: /Perfil: Ninguno/ })).toBeVisible();
  await block.getByRole("tab", { name: "Prompt" }).click();
  await block.getByRole("button", { name: "Editar prompt" }).click();

  const editor = page.getByRole("dialog", { name: "Editar super-agente" });
  const nav = editor.getByRole("button", { name: /^Perfil/ });
  await expect(nav).toContainText("Ninguno");
  await nav.click();
  await expect(editor.getByRole("radio", { name: /Ninguno/ })).toBeChecked();

  await editor.getByRole("radio", { name: /Coach de foco/ }).click();
  await expect(editor.getByRole("radio", { name: /Coach de foco/ })).toBeChecked();
  await expect(nav).toContainText("Coach de foco");
  await expect(editor.getByText("Una cosa para hoy", { exact: true }).last()).toBeVisible();
  await expect.poll(async () => (await rpc<Listed>("profiles.list")).active.id).toBe("focus");
  // Applied without Save: nothing pending in the editor's draft.
  await expect(editor.getByRole("button", { name: "Descartar" })).toBeDisabled();
  // The block behind the modal follows too (out of the accessibility tree while the editor is open).
  await expect(block.locator(".teamdetail__superlink").first()).toContainText("Perfil: Coach de foco");

  await editor.getByRole("button", { name: "Abrir en Configuración" }).click();
  await expect(editor).toBeHidden();
  const config = page.getByRole("dialog", { name: "Configuración" });
  await expect(config.getByRole("radio", { name: /Coach de foco/ })).toBeChecked();

  // And back: a switch in Settings shows in the editor the next time it opens.
  await config.getByRole("radio", { name: /Secretaria/ }).click();
  await expect.poll(async () => (await rpc<Listed>("profiles.list")).active.id).toBe("secretary");
  await config.getByRole("button", { name: /Editar a / }).click();
  await expect(block.getByRole("button", { name: /Perfil: Secretaria/ })).toBeVisible();
  await block.getByRole("button", { name: "Editar prompt" }).click();
  const again = page.getByRole("dialog", { name: "Editar super-agente" });
  await again.getByRole("button", { name: /^Perfil/ }).click();
  await expect(again.getByRole("radio", { name: /Secretaria/ })).toBeChecked();
  await expect(again.getByText("Abrir el día", { exact: true }).last()).toBeVisible();
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
