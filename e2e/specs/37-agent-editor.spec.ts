// The agent editor: an area created on the spot, an agent marked orchestrator from its menu, a rule changed away from
// the project's after a warning, and the tools list searched.
import { expect, open, rpc, test } from "./kit.ts";

test("the editor creates an area, takes its own rules after a warning, and searches tools", async ({ page }) => {
  await rpc("setup.finish", {});
  await rpc("projects.update_base", { kind: "company" });
  await rpc("agents.create", { slug: "ledger", name: "Ledger", role: "Bookkeeper" });
  await open(page, "#project=~default&tab=team");

  // The menu marks it as the one that runs the team.
  await page.locator(".teamcanvas__node", { hasText: "Ledger" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Orquestador" }).click();
  await expect
    .poll(async () => (await rpc<{ agent: { orchestrator?: boolean } }>("agents.get", { agent: "ledger" })).agent)
    .toMatchObject({ orchestrator: true });

  await page.locator(".teamcanvas__node", { hasText: "Ledger" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const editor = page.getByRole("dialog", { name: "Editar a Ledger" });

  await editor.getByRole("combobox", { name: "Área" }).click();
  await page.getByRole("option", { name: "Nueva área…" }).click();
  const area = page.getByRole("dialog", { name: "Nueva área" });
  await area.getByLabel("Área").fill("Finanzas");
  await area.getByRole("button", { name: "Crear" }).click();
  await expect(editor.getByRole("combobox", { name: "Área" })).toHaveText(/Finanzas/);

  // It followed the project's autonomy: changing one rule warns that it now goes its own way in every case.
  await editor.getByRole("button", { name: "Reglas por caso" }).click();
  await editor.getByRole("radio", { name: "Apagada" }).last().click();
  const warn = page.getByRole("dialog", { name: "¿Dejar de usar las reglas del proyecto?" });
  await warn.getByRole("button", { name: "Usar reglas propias" }).click();
  await expect(editor.getByText(/Usa reglas propias/)).toBeVisible();

  await editor.getByRole("button", { name: "Tools" }).click();
  await editor.getByRole("searchbox", { name: "Buscar tools" }).fill("browser_cl");
  await expect(editor.getByText("browser_click")).toBeVisible();
  await expect(editor.getByText("file_read")).toHaveCount(0);

  await editor.getByRole("button", { name: "Guardar y cerrar" }).click();
  await expect(editor).toHaveCount(0);
  const ledger = await rpc<{ agent: { area?: string; rules?: Record<string, string> } }>("agents.get", {
    agent: "ledger",
  });
  expect(ledger.agent.area).toBe("finanzas");
  expect(ledger.agent.rules).toEqual({ read: "auto", write: "auto", outside: "ask", irreversible: "off" });

  // Back to how other specs expect it.
  await rpc("agents.archive", { agent: "ledger" });
  await rpc("org.set", { organization: { areas: [], roles: [] } });
  await rpc("projects.update_base", { kind: null });
});
