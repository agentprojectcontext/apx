// The team's own actions: a new agent from "+ Agente", and a right-click menu on every card and row to see, edit,
// chat with or delete it. The super-agent cannot be deleted; a project agent's file is archived, never erased.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

test("a global agent is created from the team, edited and deleted from its right-click menu", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page, "#project=~default&tab=team");

  await page.getByRole("button", { name: "Agente", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo agente" });
  await dialog.getByLabel("Nombre").fill("Northwind Analyst");
  await dialog.getByLabel("Rol").fill("Reads the numbers");
  await dialog.getByRole("button", { name: "Crear agente" }).click();
  await expect(dialog).toHaveCount(0);
  const card = page.locator(".teamcanvas__node", { hasText: "Northwind Analyst" });
  await expect(card).toBeVisible();

  await card.click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText(["Ver detalle", "Editar", "Chatear", "Borrar agente"]);
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(page.getByRole("dialog", { name: "Editar a Northwind Analyst" })).toBeVisible();
  await page.keyboard.press("Escape");

  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Borrar agente" }).click();
  const confirm = page.getByRole("dialog", { name: "¿Borrar a Northwind Analyst?" });
  await confirm.getByRole("button", { name: "Borrar agente" }).click();
  await expect(card).toHaveCount(0);

  // The super-agent says why it cannot go.
  await page.locator(".teamcanvas__node:has(.apx-agentnode.is-lead)").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Borrar agente" })).toBeDisabled();
  await expect(page.getByText("El super-agente no se puede borrar")).toBeVisible();
  await page.keyboard.press("Escape");

  // The list view has the same menu, on right-click and on its "…" button.
  await page.getByRole("radio", { name: "Lista" }).click();
  const row = page.locator(".team__row").first();
  await row.getByRole("button", { name: /^Opciones de / }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Ver detalle", "Editar", "Chatear", "Borrar agente"]);
  await expect(page.getByText("El super-agente no se puede borrar")).toBeVisible();
});

test("a project agent is written to .apc/agents/ and, deleted, archived with its reports moved up", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-team-")));
  const agents = path.join(repo, ".apc", "agents");
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  fs.writeFileSync(path.join(agents, "boss.md"), "---\nname: Boss\nrole: Orchestrator\n---\n\nLead.\n");
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;
  await open(page, `#project=${project}&tab=team`);

  await page.getByRole("button", { name: "Agente", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo agente" });
  await dialog.getByLabel("Nombre").fill("Ana Pérez");
  await expect(dialog.getByText(".apc/agents/ana-perez.md")).toBeVisible();
  await dialog.getByRole("button", { name: "Crear agente" }).click();
  await expect.poll(() => fs.existsSync(path.join(agents, "ana-perez.md"))).toBe(true);

  const card = page.locator(".teamcanvas__node", { hasText: "Ana Pérez" });
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Borrar agente" }).click();
  await page
    .getByRole("dialog", { name: "¿Borrar a Ana Pérez?" })
    .getByRole("button", { name: "Borrar agente" })
    .click();
  await expect(card).toHaveCount(0);
  expect(fs.existsSync(path.join(agents, "ana-perez.md"))).toBe(false);
  expect(fs.readdirSync(path.join(agents, ".archived")).some((f) => f.startsWith("ana-perez-"))).toBe(true);
});

test("in the base project the super-agent is on top and a global agent can report to another one", async ({ page }) => {
  await rpc("setup.finish", {});
  const lead = await rpc<{ id: string }>("agents.create", { slug: "northwind-ops", name: "Northwind Ops" });
  await rpc("agents.create", { slug: "northwind-desk", name: "Northwind Desk" });
  await open(page, "#project=~default&tab=team");

  const desk = page.locator(".teamcanvas__node", { hasText: "Northwind Desk" });
  await desk.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ver detalle" }).click();
  const detail = page.locator(".teamdetail");
  const parent = detail.getByRole("button", { name: "Reporta a" });
  await expect(parent).toHaveText(/el super-agente \(por defecto\)/);
  await parent.click();
  await page.getByRole("menuitem", { name: "Northwind Ops" }).click();
  await page
    .getByRole("dialog", { name: "¿Cambiar a quién reporta?" })
    .getByRole("button", { name: "Cambiar" })
    .click();
  await expect(parent).toHaveText("Northwind Ops");
  const saved = await rpc<{ agent: { parent?: string } }>("agents.get", { agent: "northwind-desk" });
  expect(saved.agent.parent).toBe(lead.id);

  // The super-agent's detail says it reports to nobody.
  await page.locator(".teamcanvas__node:has(.apx-agentnode.is-lead)").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Ver detalle" }).click();
  await expect(detail.getByText("A nadie: es el super-agente, arriba de todos.")).toBeVisible();

  // Its autonomy is the owner's to set: with none of its own it goes as far as its project; total acts without asking.
  const autonomy = detail.getByRole("button", { name: "Autonomía" });
  const fromProject = "Del proyecto: Pregunta si hay contenido de afuera";
  await expect(autonomy).toHaveText(fromProject);
  await autonomy.click();
  await page.getByRole("menuitem", { name: "Total: actúa sin preguntar" }).click();
  await expect(autonomy).toHaveText("Total: actúa sin preguntar");
  const own = async () => (await rpc<{ agent: { autonomy?: string } }>("agents.get", { agent: "roby" })).agent.autonomy;
  expect(await own()).toBe("total");
  await autonomy.click();
  await page.getByRole("menuitem", { name: fromProject }).click();
  await expect(autonomy).toHaveText(fromProject);
  expect(await own()).toBeUndefined();
});
