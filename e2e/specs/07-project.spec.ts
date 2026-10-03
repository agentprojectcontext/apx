// A project's views: the team chart of the imported project, the files of the one added in the setup, and the owner's
// own Claude Code and Codex sessions on "this Mac".
import { expect, open, rpc, test } from "./kit.ts";

test("the imported project shows its team", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Northwind/ }).click();
  await page.getByRole("tab", { name: "Equipo" }).click();
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
