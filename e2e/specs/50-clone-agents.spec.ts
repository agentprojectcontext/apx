// A project borrows another's team: Import › Another project copies the agents picked, with new names by default.
import { expect, open, rpc, test } from "./kit.ts";

type Agent = { id: string; name: string; project_id?: string; kind: string };

test("agents of another project are copied into this one with new names", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Clone target" });
  const globals = (await rpc<{ agents: Agent[] }>("agents.list")).agents.filter(
    (a) => !a.project_id && a.kind !== "secretary",
  );
  expect(globals.length).toBeGreaterThan(0);

  await open(page, `#project=${project.id}&tab=team`);
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Importar agentes" });
  await dialog.getByRole("radio", { name: "Otro proyecto" }).click();
  await expect(dialog.getByRole("switch", { name: "Ponerles nombres nuevos" })).toBeChecked();
  const group = dialog.locator(".teamimport__team", { hasText: "Agentes globales" });
  await group.getByRole("button", { name: "Elegir todos" }).click();
  for (const box of await group.getByRole("checkbox").all()) await expect(box).toBeChecked();
  await dialog.getByRole("button", { name: `Copiar ${globals.length}` }).click();
  await expect(dialog).toBeHidden();

  const copies = async () =>
    (await rpc<{ agents: Agent[] }>("agents.list")).agents.filter((a) => a.project_id === project.id);
  await expect.poll(async () => (await copies()).length).toBe(globals.length);
  const names = new Set(globals.map((a) => a.name));
  for (const a of await copies()) expect(names.has(a.name)).toBe(false);
});
