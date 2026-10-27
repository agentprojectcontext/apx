import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const channelIds = ["telegram", "discord", "whatsapp", "slack", "email"];
async function mockChannels(page: Page) {
  await page.route("**/rpc/channels.list", async (route) =>
    route.fulfill({
      json: {
        ok: true,
        result: {
          channels: channelIds.map((id) => ({
            id,
            type: id,
            label: id === "telegram" ? "Telegram con nombre largo de canal" : id[0]?.toUpperCase() + id.slice(1),
            enabled: true,
            agent_id: "roby",
            strangers: "pair",
            concurrency: "queue",
            owner_thread: "own",
            token_set: true,
            status: "running",
          })),
        },
      },
    }),
  );
}

const orderedIds = (page: Page, kind: string) =>
  page
    .locator(`.sidebar [data-${kind}-id]`)
    .evaluateAll((rows, kind) => rows.map((row) => row.getAttribute(`data-${kind}-id`)), kind);

test("Canales recientes, tres visibles, acciones integradas y menú idéntico con clic derecho", async ({ page }) => {
  await page.setViewportSize({ width: 1480, height: 900 });
  await mockChannels(page);
  const base = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Channel activity" });
  const at = new Map(
    channelIds.map((id, index) => [id, new Date(Date.UTC(2001, 0, 1) - (index + 1) * 1000).toISOString()]),
  );
  at.set("slack", new Date(Date.UTC(2001, 0, 1) - 100).toISOString());
  await page.route("**/rpc/threads.list", async (route) =>
    route.fulfill({
      json: {
        ok: true,
        result: {
          threads: channelIds.map((id, index) => ({
            ...base,
            id: `${base.id}_${id}`,
            channel: { id, conversation: `room-${id}` },
            updated_at: at.get(id),
            unread: index === 4 ? 2 : 0,
          })),
        },
      },
    }),
  );
  await open(page, "#view=tasks");
  await expect.poll(() => orderedIds(page, "channel")).toEqual(["slack", "telegram", "discord"]);
  const more = page.getByRole("button", { name: "2 canales más · 2 sin leer" });
  await more.hover();
  await expect(page.locator(".apx-tooltip")).toContainText("2 canales más · 2 sin leer");
  const row = page.locator('.sidebar [data-channel-id="telegram"]');
  const options = row.getByRole("button", { name: "Opciones de Telegram con nombre largo de canal" });
  await page.mouse.move(1000, 800);
  await expect(row.locator(".sidebar-navrow__actions")).toHaveCSS("opacity", "0");
  await row.locator(".apx-nav").click();
  await expect(row).toHaveClass(/is-active/);
  await row.hover();
  await expect(row.locator(".sidebar-navrow__actions")).toHaveCSS("opacity", "1");
  await expect(row.locator(".apx-nav")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const geometry = await row.evaluate((row) => {
    const nav = row.querySelector(".apx-nav")?.getBoundingClientRect();
    const action = row.querySelector(".sidebar-navrow__options")?.getBoundingClientRect();
    const label = row.querySelector(".apx-nav__label");
    if (!nav || !action || !label) throw new Error("Missing navigation row controls");
    return {
      inside: action.left >= nav.left && action.right <= nav.right,
      mask: getComputedStyle(label).maskImage,
      nested: row.querySelectorAll("button button").length,
    };
  });
  expect(geometry.inside).toBe(true);
  expect(geometry.mask).toContain("linear-gradient");
  expect(geometry.nested).toBe(0);
  await options.hover();
  await expect(page.locator(".apx-tooltip")).toContainText("Opciones de Telegram");
  await options.click();
  await expect(page.getByRole("menuitem", { name: "Abrir", exact: true })).toBeVisible();
  const menuLabels = await page.getByRole("menuitem").allTextContents();
  await page.keyboard.press("Escape");
  await row.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Abrir", exact: true })).toBeVisible();
  expect(await page.getByRole("menuitem").allTextContents()).toEqual(menuLabels);
  await page.keyboard.press("Escape");
  await page.locator('.sidebar [data-channel-id="discord"]').dragTo(row, { targetPosition: { x: 25, y: 1 } });
  await expect.poll(() => orderedIds(page, "channel")).toEqual(["slack", "discord", "telegram"]);
  await page.reload();
  await expect.poll(() => orderedIds(page, "channel")).toEqual(["slack", "discord", "telegram"]);
  at.set("email", new Date(Date.UTC(2001, 0, 1) + 1000).toISOString());
  await page.reload();
  await expect.poll(() => orderedIds(page, "channel")).toEqual(["email", "slack", "discord"]);
  await expect(page.locator(".channelsnav__shown [data-channel-id]")).toHaveCount(3);
});

test("Proyectos: último acceso, arrastre, menús v1, copia y confirmación antes de quitar registro", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1480, height: 900 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const info = await world.info();
  const projects: Array<{ id: string; path: string; name: string }> = [];
  for (const name of ["Acme", "Northwind", "Amber", "Birch", "Cedar", "Delta", "Elm"]) {
    const dir = path.join(info.dir, "sidebar-projects", name);
    fs.mkdirSync(dir, { recursive: true });
    const { project } = await rpc<{ project: { id: string } }>("projects.register", { path: dir, init: true });
    projects.push({ id: project.id, path: dir, name });
  }
  const acme = projects[0];
  const northwind = projects[1];
  if (!acme || !northwind) throw new Error("Missing project fixtures");
  await open(page, "#view=tasks");
  await expect.poll(async () => (await orderedIds(page, "project"))[0]).toBe("~default");
  // Projects' own "N más" (the channels section has its own "N canales más").
  const more = page.getByRole("button", { name: /^\d+ más$/ });
  await more.click();
  const overflow = page.locator(".apx-popover");
  const hidden = overflow.locator(`[data-project-id="${northwind.id}"]`);
  await hidden.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Configuración del proyecto", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Configuración de Northwind" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Opened from "N más", a project comes first after the base space.
  await more.click();
  await overflow.locator(`[data-project-id="${northwind.id}"] .apx-nav`).click();
  await expect.poll(async () => (await orderedIds(page, "project"))[1]).toBe(northwind.id);
  // One already in view keeps its place: opening it reorders nothing, not even after a reload.
  const inView = (await orderedIds(page, "project")).slice(0, 5);
  const third = page.locator(`.sidebar [data-project-id="${inView[3]}"]`);
  await third.locator(".apx-nav").click();
  await expect(third.locator(".apx-nav")).toHaveAttribute("aria-current", "page");
  expect((await orderedIds(page, "project")).slice(0, 5)).toEqual(inView);
  await page.reload();
  await expect.poll(async () => (await orderedIds(page, "project")).slice(0, 5)).toEqual(inView);
  const row = page.locator(`.sidebar [data-project-id="${acme.id}"]`);
  // Projects from earlier specs may leave Acme in the overflow: opened from wherever it is, it ends up in view.
  if (!(await row.isVisible())) {
    await more.click();
    await overflow.locator(`[data-project-id="${acme.id}"] .apx-nav`).click();
    await expect.poll(async () => (await orderedIds(page, "project"))[1]).toBe(acme.id);
  }
  await row.hover();
  await row.getByRole("button", { name: "Opciones de Acme" }).click();
  await expect(page.getByRole("menuitem", { name: "Abrir", exact: true })).toBeVisible();
  const labels = await page.getByRole("menuitem").allTextContents();
  await page.getByRole("menuitem", { name: "Copiar ruta", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(acme.path);
  await row.click({ button: "right" });
  await expect.poll(() => page.getByRole("menuitem").allTextContents()).toEqual(labels);
  let removals = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/rpc/projects.unregister")) removals++;
  });
  await page.getByRole("menuitem", { name: "Quitar registro del proyecto" }).click();
  const confirm = page.getByRole("dialog", { name: "¿Quitar registro de Acme?" });
  await expect(confirm).toBeVisible();
  expect(removals).toBe(0);
  await confirm.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(row).toBeVisible();
  await page.locator(`.sidebar [data-project-id="${northwind.id}"]`).dragTo(row, { targetPosition: { x: 20, y: 1 } });
  await expect
    .poll(async () => {
      const ids = await orderedIds(page, "project");
      return ids.indexOf(acme.id) - ids.indexOf(northwind.id);
    })
    .toBe(1);
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Quitar registro del proyecto" }).click();
  await confirm.getByRole("button", { name: "Quitar registro del proyecto" }).click();
  await expect(row).toHaveCount(0);
  expect(removals).toBe(1);
  expect(fs.existsSync(path.join(acme.path, "AGENTS.md"))).toBe(true);
  await page.locator('.sidebar [data-project-id="~default"]').click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Quitar registro del proyecto" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Nuevo proyecto", exact: true }).hover();
  await expect(page.locator(".apx-tooltip")).toContainText("Nuevo proyecto");
});

test("Sesiones externas: orden por acceso y arrastre, mismas opciones en ambos menús", async ({ page }) => {
  await page.setViewportSize({ width: 1480, height: 900 });
  await page.route("**/rpc/engines.status", async (route) =>
    route.fulfill({
      json: {
        ok: true,
        result: {
          engines: ["claude", "codex"].map((id) => ({
            id,
            label: id === "claude" ? "Claude Code" : "Codex",
            installed: true,
            logged_in: false,
            default: false,
          })),
        },
      },
    }),
  );
  await open(page, "#view=tasks");
  await expect.poll(() => orderedIds(page, "engine")).toEqual(["claude", "codex"]);
  const codex = page.locator('.sidebar [data-engine-id="codex"]');
  await codex.locator(".apx-nav").click();
  await expect.poll(() => orderedIds(page, "engine")).toEqual(["codex", "claude"]);
  await page.reload();
  await expect.poll(() => orderedIds(page, "engine")).toEqual(["codex", "claude"]);
  await codex.hover();
  await codex.getByRole("button", { name: "Opciones de Codex" }).click();
  await expect(page.getByRole("menuitem", { name: "Abrir", exact: true })).toBeVisible();
  const labels = await page.getByRole("menuitem").allTextContents();
  await page.keyboard.press("Escape");
  await codex.click({ button: "right" });
  await expect.poll(() => page.getByRole("menuitem").allTextContents()).toEqual(labels);
  await page.keyboard.press("Escape");
  await page.locator('.sidebar [data-engine-id="claude"]').dragTo(codex, { targetPosition: { x: 20, y: 1 } });
  await expect.poll(() => orderedIds(page, "engine")).toEqual(["claude", "codex"]);
});

test("the Projects section shows more or fewer rows from its bottom edge, never under five", async ({ page }) => {
  const info = await world.info();
  for (const name of ["Fir", "Gum", "Hazel", "Ivy", "Juniper", "Kapok", "Larch", "Maple", "Nutmeg"]) {
    const dir = path.join(info.dir, "sidebar-rows", name);
    fs.mkdirSync(dir, { recursive: true });
    await rpc("projects.register", { path: dir, init: true });
  }
  // The icon rail has no section edges to drag.
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "#view=tasks");
  const rows = page.locator(".sidebar__scroll [data-project-id]");
  await expect(rows).toHaveCount(5);
  const grip = page.getByRole("separator", { name: "Mostrar más o menos proyectos" });
  // The edge is the divider under the section, not a second line beside it (in every section that has one).
  await expect(page.locator(".sidebar__grip + .sidebar__divider").filter({ visible: true })).toHaveCount(0);
  await grip.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(rows).toHaveCount(7);
  await page.reload();
  await expect(rows).toHaveCount(7);
  for (let i = 0; i < 4; i++) await grip.press("ArrowUp");
  await expect(rows).toHaveCount(5);
  await expect(page.getByRole("button", { name: /^\d+ más$/ })).toBeVisible();
});

test("Resources sits under Tasks and the account menu offers Settings and Language, without a profile entry", async ({
  page,
}) => {
  await open(page);
  const top = page.locator(".sidebar__top");
  await expect(top.getByRole("button", { name: "Recursos", exact: true })).toBeVisible();
  await expect(page.locator(".sidebar__foot").getByRole("button", { name: "Config", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await expect(page.getByRole("menuitem", { name: /^Configuración(?! inicial)/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Perfil y cuenta" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: /^Idioma/ }).hover();
  await expect(page.getByRole("menuitem", { name: "English", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Español", exact: true }).click();
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: /^Configuración(?! inicial)/ }).click();
  await expect(page.getByRole("dialog", { name: "Configuración" })).toBeVisible();
});
