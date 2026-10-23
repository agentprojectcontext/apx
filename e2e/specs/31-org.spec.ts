// The base project becomes a company: renamed (it stays the base), its kind set, its areas and roles added, and an
// agent given an area and a role from them.
import { expect, open, rpc, test } from "./kit.ts";

test("the base project is renamed and made a company, with areas and roles its agents take", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page, "#project=~default&tab=overview");

  await page.getByRole("button", { name: "Configuración del proyecto" }).click();
  const settings = page.getByRole("dialog");
  await expect(settings.getByText("Sigue siendo el proyecto base aunque le cambies el nombre.")).toBeVisible();
  await settings.getByLabel("Nombre").fill("Northwind HQ");
  await settings.getByRole("combobox", { name: "Tipo" }).click();
  await page.getByRole("option", { name: /Empresa/ }).click();
  await settings.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("heading", { name: "Northwind HQ", level: 1 })).toBeVisible();
  // Everywhere it is named: the breadcrumb, and its tile's initial in the sidebar.
  await expect(page.locator(".topbar__crumbs")).toContainText("Northwind HQ");
  await expect(page.locator('.sidebar [data-project-id="~default"]')).toContainText("N");

  // A company shows its areas and roles.
  await page.locator(".project__tabs").getByRole("tab", { name: "Agentes" }).click();
  await page.locator(".team__tabs").getByRole("tab", { name: "Áreas y roles" }).click();
  await page.getByRole("button", { name: "Agregar un área" }).click();
  const area = page.getByRole("dialog", { name: "Nueva área" });
  await area.getByLabel("Nombre").fill("Finanzas");
  await area.getByLabel("Objetivo").fill("Que la plata alcance");
  await area.getByRole("button", { name: "Guardar" }).click();
  const card = page.locator(".org__area", { hasText: "Finanzas" });
  await expect(card).toContainText("Que la plata alcance");
  await card.getByRole("button", { name: "Rol" }).click();
  const role = page.getByRole("dialog", { name: "Nuevo rol" });
  await role.getByLabel("Nombre").fill("Chief Financial Officer");
  await role.getByRole("button", { name: "Guardar" }).click();
  await expect(card.getByRole("button", { name: "Chief Financial Officer" })).toBeVisible();
  const org = await rpc<{ areas: Array<{ slug: string }>; roles: Array<{ name: string; area?: string }> }>("org.get");
  expect(org.roles).toEqual([{ slug: "chief-financial-officer", name: "Chief Financial Officer", area: "finanzas" }]);

  // An agent takes the role, and with it its area.
  await page.locator(".team__tabs").getByRole("tab", { name: "Agentes" }).click();
  await page.locator(".teamcanvas__node", { hasText: "Scout" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const editor = page.getByRole("dialog", { name: /^Editar a / });
  await editor.getByRole("combobox", { name: "Rol" }).click();
  await page.getByRole("option", { name: /Chief Financial Officer/ }).click();
  await expect(editor.getByRole("combobox", { name: "Área" })).toHaveText(/Finanzas/);
  await editor.getByRole("button", { name: "Guardar y cerrar" }).click();
  await expect(editor).toHaveCount(0);
  const scout = await rpc<{ agent: { role: string; area?: string } }>("agents.get", { agent: "scout" });
  expect([scout.agent.role, scout.agent.area]).toEqual(["Chief Financial Officer", "finanzas"]);
  // Its pill on the chart says the area's name, not its id.
  await expect(page.locator(".teamcanvas__pill", { hasText: "Finanzas" })).toBeVisible();

  // Back to how other specs expect it.
  await rpc("projects.update_base", { name: "Default", kind: null });
});

test("importing the executive team into the base project sets the company up in one go", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page, "#project=~default&tab=team");
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Importar agentes" });
  const team = dialog.locator(".teamimport__team", { hasText: "Executive team" });
  await team.getByRole("button", { name: "Elegir todos" }).click();
  await expect(dialog.getByText(/Este equipo convierte el proyecto en una empresa/)).toBeVisible();
  await dialog.getByRole("button", { name: /^Instalar/ }).click();
  await expect(dialog).toHaveCount(0);

  // The CEO leads its team under the super-agent; the project is a company with the team's areas. Each member has
  // a person's name, and the template's job is its role.
  const cfo = (await rpc<{ agent: { name: string; role: string } }>("agents.get", { agent: "cfo" })).agent;
  expect(cfo.role).toBe("Chief Financial Officer");
  expect(cfo.name).not.toBe("Chief Financial Officer");
  await expect(page.locator(`.apx-agentnode__name:text-is("${cfo.name}")`)).toBeVisible();
  const tab = page.locator(".team__tabs").getByRole("tab", { name: "Áreas y roles" });
  await tab.click();
  await expect(page.locator(".org__area", { hasText: "Finance" })).toContainText("Chief Financial Officer");
  expect((await rpc<{ agent: { parent?: string } }>("agents.get", { agent: "cfo" })).agent.parent).toBe("ceo");
  const routines = await rpc<{ routines: Array<{ agent_id: string }> }>("routines.list");
  expect(routines.routines.some((r) => r.agent_id === "ceo")).toBe(true);

  await rpc("projects.update_base", { kind: null });
});
