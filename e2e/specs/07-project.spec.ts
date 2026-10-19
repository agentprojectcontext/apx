// A project's views: the team chart of the imported project, the files of the one added in the setup, and the owner's
// own Claude Code and Codex sessions on "this Mac".
import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test, world } from "./kit.ts";

test("the imported project shows its team", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Northwind/ }).click();
  await page.getByRole("tab", { name: /^Agentes/ }).click();
  await expect(page.getByText("Dev").first()).toBeVisible();
  await expect(page.getByText("Ops").first()).toBeVisible();
});

test("another project opened from the sidebar keeps the tab that was open", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Northwind/ }).click();
  await page.getByRole("tab", { name: "Memoria" }).click();
  await page.getByRole("button", { name: /^acme/i }).click();
  await expect(page.getByRole("tab", { name: "Memoria" })).toHaveAttribute("aria-selected", "true");
});

test("the imported project keeps its notes and its routine, which came in off", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Northwind/ }).click();
  await page.getByRole("tab", { name: "Memoria" }).click();
  await expect(page.getByText("Deploys go out on Fridays")).toBeVisible();
  await page.getByRole("tab", { name: "Rutinas" }).click();
  await expect(page.getByText("Morning brief")).toBeVisible();
  const routines = await rpc<{ routines: Array<{ name: string; enabled: boolean }> }>("routines.list", {});
  expect(routines.routines.find((r) => r.name === "Morning brief")?.enabled).toBe(false);
});

test("a project's files open as text", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^acme/i }).click();
  await page.getByRole("tab", { name: "Archivos" }).click();
  await page.getByRole("button", { name: "README.md" }).click();
  await expect(page.getByText("A small shop.")).toBeVisible();
});

test("a project's text file opens as code with line numbers, is edited and saved in place", async ({ page }) => {
  const { repo } = await world.info();
  fs.writeFileSync(path.join(repo, "price.ts"), "export const TAX = 0.21;\n");
  await open(page);
  await page.getByRole("button", { name: /^acme/i }).click();
  await page.getByRole("tab", { name: "Archivos" }).click();
  await page.getByRole("button", { name: "price.ts" }).click();
  const code = page.locator(".cm-content");
  await expect(code).toContainText("export const TAX = 0.21;");
  await expect(page.locator(".cm-lineNumbers")).toContainText("1");
  await page.getByRole("button", { name: "Editar" }).click();
  await code.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("export const SHIP = 5;");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("button", { name: "Editar" })).toBeVisible();
  expect(fs.readFileSync(path.join(repo, "price.ts"), "utf8")).toBe("export const TAX = 0.21;\nexport const SHIP = 5;");
  fs.rmSync(path.join(repo, "price.ts"));
});

test("the owner's Claude Code and Codex sessions are listed", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Claude Code", exact: true }).click();
  await expect(page.getByText("Refactor the cart module")).toBeVisible();
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await expect(page.getByText("Add a footer")).toBeVisible();
});

test("a plain folder becomes a project from the sidebar and opens", async ({ page }) => {
  const { dir } = await world.info();
  await open(page);
  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Carpeta" }).fill(`${dir}/work/globex`);
  await dialog.getByRole("button", { name: "Sumar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "globex" })).toBeVisible();
  await page.getByRole("tab", { name: "Archivos" }).click();
  await expect(page.getByRole("button", { name: "AGENTS.md" })).toBeVisible();
});

test("a project without a folder is made inside APX's, with its name and kind", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Sin carpeta" }).click();
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Ventas Q4");
  await expect(dialog.getByText("~/.apx/v2/projects/ventas-q4")).toBeVisible();
  await dialog.getByRole("combobox", { name: "Tipo" }).click();
  await page.getByRole("option", { name: /^Empresa/ }).click();
  await dialog.getByRole("button", { name: "Sumar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Ventas Q4" })).toBeVisible();
  const made = (
    await rpc<{ projects: Array<{ name: string; kind?: string; path?: string }> }>("projects.list")
  ).projects.find((p) => p.name === "Ventas Q4");
  expect(made?.kind).toBe("company");
  expect(made?.path).toMatch(/projects[/\\]ventas-q4$/);
});

test("a project file can be renamed and moved to trash from its context menu", async ({ page }) => {
  const { repo } = await world.info();
  const source = path.join(repo, "rename-me.txt");
  const trashed = path.join(repo, "remove-me.txt");
  fs.writeFileSync(source, "rename this fixture\n");
  fs.writeFileSync(trashed, "remove this fixture\n");
  try {
    await open(page);
    await page.getByRole("button", { name: /^acme/i }).click();
    await page.getByRole("tab", { name: "Archivos" }).click();

    await page.getByRole("button", { name: "rename-me.txt" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Renombrar" }).click();
    const rename = page.getByRole("dialog", { name: "Renombrar" });
    await rename.getByRole("textbox", { name: "Nombre nuevo" }).fill("renamed.txt");
    await rename.getByRole("button", { name: "Renombrar" }).click();
    await expect(rename).toBeHidden();
    await expect(page.getByRole("button", { name: "renamed.txt" })).toBeVisible();
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(path.join(repo, "renamed.txt"), "utf8")).toBe("rename this fixture\n");

    await page.getByRole("button", { name: "remove-me.txt" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Mover a la papelera" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByRole("heading", { name: /remove-me.txt/ })).toBeVisible();
    await confirm.getByRole("button", { name: "Mover a la papelera" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole("button", { name: "remove-me.txt" })).toHaveCount(0);
    expect(fs.existsSync(trashed)).toBe(false);
    const { paths } = await world.desktopTrash();
    expect(paths).toContain(path.join(fs.realpathSync(repo), "remove-me.txt"));
  } finally {
    fs.rmSync(source, { force: true });
    fs.rmSync(path.join(repo, "renamed.txt"), { force: true });
    fs.rmSync(trashed, { force: true });
  }
});
