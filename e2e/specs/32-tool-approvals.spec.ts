import path from "node:path";
import { expect, open, rpc, test, world } from "./kit.ts";

const server = path.resolve("apps/core/src/mcp/fake-server.test-support.mjs");

test("Resources lists a server's tools, allows all or some for every agent, and revokes server trust", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  await rpc("mcp.set", { name: "permissions", server: { command: process.execPath, args: [server] } });
  await open(page, "#view=resources&resourcesTab=mcp");
  await page.getByRole("radio", { name: /^MCP/ }).click();
  await page.getByRole("button", { name: /^permissions/ }).click();
  const tools = page.locator(".mcptools");
  await tools.getByRole("radio", { name: "Todas permitidas" }).click();
  await expect(tools.getByRole("button", { name: "echo" })).toHaveAttribute("aria-pressed", "true");
  await expect(tools.getByRole("button", { name: "token" })).toHaveAttribute("aria-pressed", "true");
  await tools.getByRole("button", { name: "token" }).click();
  await expect(tools.getByRole("button", { name: "token" })).toHaveAttribute("aria-pressed", "false");
  await expect(tools.getByRole("radio", { name: "Algunas" })).toHaveAttribute("aria-checked", "true");
  await tools.getByRole("radio", { name: "Preguntar" }).click();
  await expect(tools.getByRole("button", { name: "echo" })).toHaveAttribute("aria-pressed", "false");
  await page.locator(".resd__row").getByRole("button", { name: "Quitar aprobación" }).click();
  await expect(page.locator(".resd__callout")).toBeVisible();
  await page.locator(".resd__callout").getByRole("button", { name: "Aprobar" }).click();
  await expect(page.locator(".resd__callout")).toBeHidden();
  await rpc("mcp.set", { name: "permissions", server: null });
});

test("right-click permissions update the list indicator, persist and open the individual picker", async ({ page }) => {
  await rpc("setup.finish", {});
  await rpc("mcp.set", { name: "context-permissions", server: { command: process.execPath, args: [server] } });
  await rpc("mcp.set", { name: "context-other", server: { command: process.execPath, args: [server] } });
  try {
    await open(page, "#view=resources&resourcesTab=mcp");
    await page.getByRole("radio", { name: /^MCP/ }).click();
    const row = page.getByRole("button", { name: /^context-permissions/ });
    await expect(row.getByRole("img", { name: /Sin verificar/ })).toBeVisible();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Permisos de tools", exact: true }).hover();
    await page.getByRole("menuitem", { name: "Todas permitidas", exact: true }).click();
    await expect(row.getByRole("img", { name: "Permisos de tools: Todas permitidas" })).toBeVisible();
    await expect(row.locator(".apx-pickrow__dot.is-on")).toBeVisible();
    await page.reload();
    await page.getByRole("radio", { name: /^MCP/ }).click();
    await expect(row.getByRole("img", { name: "Permisos de tools: Todas permitidas" })).toBeVisible();

    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Permisos de tools", exact: true }).hover();
    await page.getByRole("menuitem", { name: "Algunas", exact: true }).click();
    const tools = page.locator(".mcptools");
    await expect(tools.getByRole("radio", { name: "Algunas" })).toHaveAttribute("aria-checked", "true");
    await tools.getByRole("button", { name: "token", exact: true }).click();
    await expect(row.getByRole("img", { name: "Permisos de tools: Algunas" })).toBeVisible();
    await page.getByRole("button", { name: /^context-other/ }).click();
    await expect(tools.getByRole("radio", { name: "Preguntar" })).toHaveAttribute("aria-checked", "true");
    await row.click();
    await expect(tools.getByRole("radio", { name: "Algunas" })).toHaveAttribute("aria-checked", "true");

    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Permisos de tools", exact: true }).hover();
    await page.getByRole("menuitem", { name: "Preguntar", exact: true }).click();
    await expect(row.getByRole("img", { name: "Permisos de tools: Preguntar" })).toBeVisible();
    await expect(tools.getByRole("button", { name: "echo", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(tools.getByRole("radio", { name: "Preguntar" })).toHaveAttribute("aria-checked", "true");

    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Quitar aprobación", exact: true }).click();
    await row.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Permisos de tools", exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.keyboard.press("Escape");
  } finally {
    await rpc("mcp.set", { name: "context-permissions", server: null });
    await rpc("mcp.set", { name: "context-other", server: null });
  }
});

test("chat offers once, session and always; session lets later calls proceed without asking", async ({ page }) => {
  const { repo } = await world.info();
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;
  await rpc("mcp.set", { project, name: "notes", server: { command: process.execPath, args: [server] } });
  const reader = await rpc<{ id: string }>("agents.create", { slug: "permission-reader", name: "Permission reader" });
  const chat = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: reader.id,
    project_id: project,
    title: "Permisos MCP",
  });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill("read MCP twice");
  await page.keyboard.press("Enter");
  const card = page.locator(".inputcard.is-pending");
  await expect(card.getByRole("button", { name: "Aceptar una vez" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Aceptar siempre para este agente" })).toBeVisible();
  await card.getByRole("button", { name: "Aceptar durante esta sesión" }).click();
  await expect(card).toBeHidden();
  await expect(page.locator(".inputline")).toContainText("Esta sesión");
  await page.getByRole("textbox", { name: /Escribile/ }).fill("read MCP twice again");
  await page.keyboard.press("Enter");
  await expect(page.locator(".transcript").getByText("Got it: read MCP twice again", { exact: true })).toBeVisible();
  await expect(card).toBeHidden();
  await rpc("mcp.set", { project, name: "notes", server: null });
});

test("a file edit waiting for the owner shows its patch across the chat's width", async ({ page }) => {
  await rpc("setup.finish", {});
  const { repo } = await world.info();
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;
  const editor = await rpc<{ id: string }>("agents.create", { slug: "patch-editor", name: "Patch editor" });
  const chat = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: editor.id,
    project_id: project,
    title: "Patch",
  });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill("edit the agents file");
  await page.keyboard.press("Enter");
  const card = page.locator(".inputcard.is-pending.has-change");
  await expect(card.locator(".inputcard__path")).toHaveText("AGENTS.md");
  await expect(card.locator(".diff__line--del")).toHaveText(/The Acme storefront\.$/);
  await expect(card.locator(".diff__line--add")).toHaveText(/The Acme storefront, rebuilt\.$/);
  await expect(card.locator(".inputcard__detail")).toHaveCount(0);
  await card.getByRole("button", { name: "Rechazar" }).click();
  await expect(card).toBeHidden();
  await page.locator(".inputline").getByRole("button").first().click();
  await expect(page.locator(".inputline .diff__line--add")).toBeVisible();
});
