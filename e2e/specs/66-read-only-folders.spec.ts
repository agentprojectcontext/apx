// A project's read-only folders: the owner adds one in the project's settings, sees it listed, and removes it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

test("a project's settings add a read-only folder, list it and remove it", async ({ page }) => {
  await rpc("setup.finish", {});
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-ro-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  const ref = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-ro-ref-")));
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;
  const listed = async () =>
    (await rpc<{ projects: Array<{ id: string; read_only_folders?: string[] }> }>("projects.list")).projects.find(
      (p) => p.id === project,
    )?.read_only_folders;

  await open(page, `#project=${project}&tab=overview`);
  await page.getByRole("button", { name: "Configuración del proyecto" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Carpetas de solo lectura")).toBeVisible();
  await expect(dialog.getByText("Ninguna todavía.")).toBeVisible();

  const field = dialog.getByRole("textbox", { name: "Carpetas de solo lectura" });
  await field.fill(ref);
  await field.press("Enter");
  const list = dialog.getByRole("list", { name: "Carpetas de solo lectura" });
  await expect(list.getByText(ref)).toBeVisible();
  await expect(field).toHaveValue("");
  expect(await listed()).toEqual([ref]);

  await list.getByRole("button", { name: `Quitar ${ref}` }).click();
  await expect(dialog.getByText("Ninguna todavía.")).toBeVisible();
  expect(await listed()).toBeUndefined();
  await rpc("projects.unregister", { project });
});
