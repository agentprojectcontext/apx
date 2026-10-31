import type { Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});

const edge = (page: Page) =>
  page.getByRole("separator", { name: "Plegar o cambiar el ancho de la barra", exact: true });
const sidebarWidth = (page: Page) =>
  page.locator(".sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().width));

/** Presses the sidebar's edge and moves it `dx` pixels in steps, like a hand would. */
async function dragEdge(page: Page, dx: number) {
  const box = await edge(page).boundingBox();
  if (!box) throw new Error("No sidebar edge");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + (dx * i) / 12, y);
  await page.mouse.up();
}

test("the topbar starts with the APX logo, then back and forward, then where you are", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const left = page.locator(".topbar__left");
  const x = async (selector: string) => (await left.locator(selector).first().boundingBox())?.x ?? -1;
  const logo = await x(".topbar__logo");
  const back = (await left.getByRole("button", { name: "Atrás", exact: true }).boundingBox())?.x ?? -1;
  const forward = (await left.getByRole("button", { name: "Adelante", exact: true }).boundingBox())?.x ?? -1;
  const crumbs = await x(".topbar__crumbs");
  expect(logo).toBeGreaterThanOrEqual(0);
  expect(logo).toBeLessThan(back);
  expect(back).toBeLessThan(forward);
  expect(forward).toBeLessThan(crumbs);
  // Folding lives on the sidebar's edge now, not in the topbar.
  await expect(page.locator(".topbar").getByRole("button", { name: /barra/ })).toHaveCount(0);
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(left.locator(".topbar__logo")).toBeVisible();
  }
});

test("a click on the sidebar's edge folds and unfolds it, keeping the width the owner chose", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).not.toHaveClass(/is-rail/);
  await dragEdge(page, 64);
  const chosen = await sidebarWidth(page);
  expect(chosen).toBeGreaterThan(280);
  // The list's scrollbar sits left of the edge, where a hand can grab it.
  const [list, grip] = await Promise.all([page.locator(".sidebar__scroll").boundingBox(), edge(page).boundingBox()]);
  expect(list && grip && list.x + list.width <= grip.x).toBe(true);
  // Hovering the edge says what a click does.
  await page.mouse.move(700, 400);
  await edge(page).hover();
  await expect(page.getByText("Clic para plegar la barra · arrastrá para cambiar el ancho")).toBeVisible();
  await edge(page).click();
  await expect(sidebar).toHaveClass(/is-rail/);
  expect(await sidebarWidth(page)).toBe(60);
  await page.reload();
  await expect(sidebar).toHaveClass(/is-rail/);
  await edge(page).click();
  await expect(sidebar).not.toHaveClass(/is-rail/);
  expect(await sidebarWidth(page)).toBe(chosen);
  // From the keyboard: Enter folds and unfolds it too.
  await edge(page).focus();
  await page.keyboard.press("Enter");
  await expect(sidebar).toHaveClass(/is-rail/);
  await page.keyboard.press("Enter");
  await expect(sidebar).not.toHaveClass(/is-rail/);
  expect(await sidebarWidth(page)).toBe(chosen);
});

test("dragging the sidebar's edge past halfway to the rail snaps it closed, and out again opens it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const sidebar = page.locator(".sidebar");
  const start = await sidebarWidth(page);
  // Narrower than the minimum, but not halfway to the rail: it stops at the minimum.
  await dragEdge(page, 200 - start - 50);
  await expect(sidebar).not.toHaveClass(/is-rail/);
  expect(await sidebarWidth(page)).toBe(200);
  await dragEdge(page, start - 200);
  expect(await sidebarWidth(page)).toBe(start);
  await dragEdge(page, -(start - 100));
  await expect(sidebar).toHaveClass(/is-rail/);
  expect(await sidebarWidth(page)).toBe(60);
  // It still remembers the width it had for a click.
  await edge(page).click();
  expect(await sidebarWidth(page)).toBe(start);
  await edge(page).click();
  await expect(sidebar).toHaveClass(/is-rail/);
  await dragEdge(page, 180);
  await expect(sidebar).not.toHaveClass(/is-rail/);
  expect(await sidebarWidth(page)).toBeGreaterThanOrEqual(200);
});

test("a window narrow enough for the rail opens the sidebar from its edge, and a phone keeps the rail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toHaveClass(/is-rail/);
  await edge(page).click();
  await expect(sidebar).not.toHaveClass(/is-rail/);
  await page.setViewportSize({ width: 1440, height: 800 });
  await edge(page).click();
  await expect(sidebar).toHaveClass(/is-rail/);
  await edge(page).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  // Unfolded in a wide window: a narrower one folds it on its own again.
  await expect(sidebar).toHaveClass(/is-rail/);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(sidebar).toHaveClass(/is-rail/);
  await expect(edge(page)).toHaveCount(0);
});

test("in the rail each section's add button is the first icon of its card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toHaveClass(/is-rail/);
  for (const [section, add] of [
    ["Proyectos", "Nuevo proyecto"],
    ["Apps", "Abrir un artefacto"],
  ] as const) {
    const card = sidebar.getByRole("group", { name: section, exact: true });
    const first = card.locator("button").first();
    await expect(first).toHaveAccessibleName(add);
    const [button, box] = await Promise.all([first.boundingBox(), card.boundingBox()]);
    if (!button || !box) throw new Error(`No ${section} card`);
    // A row of the card, as wide as its other icons, not a small button beside them.
    expect(button.height).toBe(32);
    expect(Math.abs(button.x + button.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
  }
  const projects = sidebar.getByRole("group", { name: "Proyectos", exact: true });
  const add = await projects.getByRole("button", { name: "Nuevo proyecto" }).boundingBox();
  const row = await projects.locator("[data-project-id]").first().boundingBox();
  expect(add && row && add.y < row.y).toBe(true);
});
