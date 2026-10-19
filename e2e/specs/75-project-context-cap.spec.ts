import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test, world } from "./kit.ts";

test("project settings show the safety cap and remove its notice after the file shrinks", async ({ page }) => {
  await rpc("setup.finish", {});
  const { dir } = await world.info();
  const folder = path.join(dir, "work", "context cap");
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "AGENTS.md");
  const text = "Read project rules before acting.\n".repeat(8_000).trimEnd();
  fs.writeFileSync(file, `${text}\n`);
  const { project } = await rpc<{ project: { id: string; agents_md_chars?: number } }>("projects.register", {
    path: folder,
  });
  expect(project.agents_md_chars).toBe(text.length);
  await open(page, `#project=${project.id}&tab=team`);
  await page.getByRole("button", { name: "Configuración del proyecto", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const notice = dialog.getByText("AGENTS.md pasa el límite", { exact: true });
  await expect(notice).toBeVisible();
  await expect(dialog.locator(".projsettings__note")).toContainText("reciben el principio y el final");
  await page.reload();
  await page.getByRole("button", { name: "Configuración del proyecto", exact: true }).click();
  await expect(notice).toBeVisible();

  fs.writeFileSync(file, "# Northwind\n\nKeep every instruction.\n");
  await rpc("projects.sync", { project: project.id });
  await expect(notice).toHaveCount(0);
  const { projects } = await rpc<{ projects: Array<{ id: string; agents_md_chars?: number }> }>("projects.list");
  expect(projects.find((p) => p.id === project.id)?.agents_md_chars).toBeUndefined();
  await test.info().attach("running-core", {
    body: JSON.stringify(await rpc("system.health")),
    contentType: "application/json",
  });
});
