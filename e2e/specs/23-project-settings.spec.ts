// A project's header: tabs with their counts, and the gear opening the project's own settings (kept in its folder).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

test("a project's tabs count its agents and chats, and its settings rename it and set its kind", async ({ page }) => {
  await rpc("setup.finish", {});
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-settings-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  fs.mkdirSync(path.join(repo, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".apc", "agents", "boss.md"), "---\nname: Boss\nrole: Orchestrator\n---\n\nLead.\n");
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;
  await rpc("threads.create", { kind: "loose", agent_id: "scout", project_id: project, title: "Uno" });

  await open(page, `#project=${project}&tab=overview`);
  const tabs = page.locator(".project__tabs");
  await expect(tabs.getByRole("tab", { name: /Agentes/ })).toContainText("1");
  await expect(tabs.getByRole("tab", { name: /Chats/ })).toContainText("1");

  await page.getByRole("button", { name: "Configuración del proyecto" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(repo)).toBeVisible();
  await dialog.getByLabel("Nombre").fill("Northwind");
  await dialog.getByRole("combobox", { name: "Tipo" }).click();
  await page.getByRole("option", { name: /Empresa/ }).click();
  // How far its agents go on their own: APX keeps it, the folder never does. The five modes, in the owner's order.
  await dialog.getByRole("combobox", { name: "Modo de permisos de los agentes" }).click();
  await expect(page.getByRole("option")).toHaveText([/^Manual/, /^Auto/, /^Acepta ediciones/, /^Plan/, /^Total/]);
  await page.getByRole("option", { name: /Acepta ediciones/ }).click();
  // Another project arriving refreshes the list while the dialog is open: what was typed stays.
  const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-settings-other-")));
  fs.writeFileSync(path.join(other, "AGENTS.md"), "# Other\n");
  const refreshed = page.waitForResponse((r) => r.url().endsWith("/rpc/projects.list"));
  const second = (await rpc<{ project: { id: string } }>("projects.register", { path: other })).project.id;
  await refreshed;
  await expect(dialog.getByLabel("Nombre")).toHaveValue("Northwind");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("heading", { name: "Northwind", level: 1 })).toBeVisible();
  const saved = JSON.parse(fs.readFileSync(path.join(repo, ".apc", "project.json"), "utf8"));
  expect(saved).toMatchObject({ name: "Northwind", kind: "company" });
  expect(saved.autonomy).toBeUndefined();
  const listed = await rpc<{ projects: Array<{ id: string; autonomy?: string }> }>("projects.list");
  expect(listed.projects.find((p) => p.id === project)?.autonomy).toBe("accept_edits");
  await rpc("projects.unregister", { project: second });

  // The base space has no folder: its settings point at making a project from one.
  await page.goto("/#project=~default&tab=overview");
  await page.getByRole("button", { name: "Configuración del proyecto" }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Nuevo proyecto desde una carpeta" }),
  ).toBeVisible();
});
