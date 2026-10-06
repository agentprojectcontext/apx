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
  await tools.getByRole("radio", { name: "Preguntan" }).click();
  await expect(tools.getByRole("button", { name: "echo" })).toHaveAttribute("aria-pressed", "false");
  await page.locator(".resd__row").getByRole("button", { name: "Quitar aprobación" }).click();
  await expect(page.locator(".resd__callout")).toBeVisible();
  await page.locator(".resd__callout").getByRole("button", { name: "Aprobar" }).click();
  await expect(page.locator(".resd__callout")).toBeHidden();
  await rpc("mcp.set", { name: "permissions", server: null });
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
  await expect(page.getByText("Got it: read MCP twice again", { exact: true })).toBeVisible();
  await expect(card).toBeHidden();
  await rpc("mcp.set", { project, name: "notes", server: null });
});
