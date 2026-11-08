import { expect, open, rpc, test } from "./kit.ts";

type Project = { id: string; name: string; parent?: string };
type Agent = { id: string; kind?: string; name: string };

let northwind: Project;
let web: Project;

test.beforeAll(async () => {
  await rpc("setup.finish");
  northwind = (await rpc<{ project: Project }>("projects.create", { name: "Northwind slim" })).project;
  web = (await rpc<{ project: Project }>("projects.create", { name: "Web slim", parent: northwind.id })).project;
  const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
  const secretary = agents.find((a) => a.kind === "secretary");
  if (!secretary) throw new Error("No super-agent");
  await rpc("routines.set", {
    name: "Slim daily digest",
    agent: secretary.id,
    schedule: { kind: "cron", cron: "0 9 * * *" },
    prompt: "Summarize the day",
  });
});

test("the compact sidebar folds each section into one row that opens beside it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const sidebar = page.locator(".sidebar");
  // Sections are rows, not cards, by default.
  await expect(sidebar.locator(".sidebar__group")).toHaveCount(0);
  const projects = sidebar.getByRole("button", { name: "Proyectos", exact: true });
  await projects.click();
  const flyout = page.getByRole("dialog", { name: "Proyectos" });
  await expect(flyout.getByText("Northwind slim", { exact: true })).toBeVisible();
  // A subproject sits right under its project.
  const names = await flyout.locator(".apx-nav__label").allTextContents();
  expect(names.indexOf("Web slim")).toBe(names.indexOf("Northwind slim") + 1);
  await flyout.getByText("Northwind slim", { exact: true }).click();
  await expect(page.locator(".project__name h1")).toHaveText("Northwind slim");
  await expect(flyout).toBeHidden();

  // The account menu turns the cards back on; the choice stays.
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Barra lateral compacta" }).click();
  await page.keyboard.press("Escape");
  await expect(sidebar.locator(".sidebar__group").first()).toBeVisible();
  await page.reload();
  await expect(sidebar.locator(".sidebar__group").first()).toBeVisible();
});

test("a short window keeps the sidebar compact even with the cards chosen", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("apx.prefs", JSON.stringify({ sidebarCompact: false })));
  await page.setViewportSize({ width: 1280, height: 700 });
  await open(page);
  await expect(page.locator(".sidebar__group")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator(".sidebar__group").first()).toBeVisible();
});

test("Routines lists every project's routines, grouped and filtered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.locator(".sidebar").getByRole("button", { name: "Rutinas", exact: true }).click();
  const screen = page.getByRole("region", { name: "Rutinas" });
  await expect(screen.getByRole("heading", { name: "Rutinas" })).toBeVisible();
  await expect(screen.getByText("Slim daily digest")).toBeVisible();
  await screen.getByPlaceholder("Buscar rutinas").fill("nothing like this");
  await expect(screen.getByText("Ninguna rutina coincide")).toBeVisible();
  await screen.getByPlaceholder("Buscar rutinas").fill("digest");
  await expect(screen.getByText("Slim daily digest")).toBeVisible();
  await expect(page).toHaveURL(/view=routines/);
});

test("a subproject shows its project, works with its agents and can become a project of its own", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, `#project=${web.id}&tab=overview`);
  await expect(page.locator(".project__parent")).toHaveText("Northwind slim");
  await expect(page.locator(".project__subnote")).toContainText("Northwind slim");
  await page.locator(".sidebar").getByRole("button", { name: "Proyectos", exact: true }).click();
  const flyout = page.getByRole("dialog", { name: "Proyectos" });
  await flyout.getByText("Web slim", { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Separar en un proyecto aparte" }).click();
  await expect(page.getByText("Web slim ahora es un proyecto aparte")).toBeVisible();
  await expect(page.locator(".project__parent")).toHaveCount(0);
  const { projects } = await rpc<{ projects: Project[] }>("projects.list");
  expect(projects.find((p) => p.id === web.id)?.parent).toBeUndefined();
});

test("New chat at the top of the sidebar opens the agent picker", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.locator(".sidebar").getByRole("button", { name: "Nuevo chat", exact: true }).click();
  await expect(page.getByPlaceholder("Buscar agente")).toBeVisible();
});
