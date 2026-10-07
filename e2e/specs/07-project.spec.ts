// A project's views: the team chart of the imported project, the files of the one added in the setup, and the owner's
// own Claude Code and Codex sessions on "this Mac".
import { expect, open, rpc, test, world } from "./kit.ts";

test("the imported project shows its team", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Northwind/ }).click();
  await page.getByRole("tab", { name: /^Agentes/ }).click();
  await expect(page.getByText("Dev").first()).toBeVisible();
  await expect(page.getByText("Ops").first()).toBeVisible();
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
