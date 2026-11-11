// Flows, Routines and Files pick the project they show from one searchable picker beside their tabs, not a row of chips.
import fs from "node:fs";
import path from "node:path";
import type { Result } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

test("Flows picks its project from a picker beside the tabs, with a search box", async ({ page }) => {
  await rpc("setup.finish", {});
  const { dir } = await world.info();
  const stamp = Date.now().toString(36);
  const name = `picker-${stamp}`;
  const folder = path.join(dir, "work", name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "AGENTS.md"), "# Northwind\n");
  const { project } = await rpc<Result<"projects.register">>("projects.register", { path: folder });

  await open(page, "#view=flows");
  const screen = page.getByRole("region", { name: "Flows", exact: true });
  const bar = screen.locator(".secpage__bar");
  const picker = bar.getByRole("combobox", { name: "Proyecto", exact: true });
  await expect(picker).toContainText("Todos los proyectos");
  await expect(screen.locator("fieldset")).toHaveCount(0);
  // Right after the tabs, on their row.
  const tabs = await bar.getByRole("radiogroup").boundingBox();
  const field = await picker.boundingBox();
  expect(field && tabs && Math.abs(field.y + field.height / 2 - (tabs.y + tabs.height / 2))).toBeLessThanOrEqual(2);
  expect(field && tabs && field.x).toBeGreaterThan((tabs?.x ?? 0) + (tabs?.width ?? 0) - 1);

  await picker.click();
  await page.getByPlaceholder("Buscá un proyecto").fill(stamp);
  await page.getByRole("option", { name }).click();
  await expect(page).toHaveURL(new RegExp(`scope=${project.id}`));
  await expect(picker).toContainText(name);
  await rpc("projects.unregister", { project: project.id });
});
