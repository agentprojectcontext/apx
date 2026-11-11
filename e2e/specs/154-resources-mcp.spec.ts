// Resources › MCP: one list look globally and in a project, rows that tell tools and permissions before a click,
// where a server lives and the projects it is on in (edited in its dialog), and its variables linked to Variables.
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { tempDir } from "../../apps/core/src/testkit/platform.ts";
import { expect, test } from "./kit.ts";

const SERVER = path.resolve("apps/core/src/mcp/fake-server.test-support.mjs");

async function fixture(page: Page) {
  await page.addInitScript(() => {
    if (location.origin !== "null") localStorage.setItem("apx.prefs", JSON.stringify({ language: "es" }));
  });
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const env = await startCore({ port, llm: scriptedLlm(() => say("ok")) });
  const dir = tempDir("apx-e2e-mcp-");
  await env.client.call("setup.finish", {});
  const northwind = (await env.client.call("projects.create", { name: "Northwind" })).project.id;
  const acme = (await env.client.call("projects.create", { name: "Acme" })).project.id;
  await env.client.call("secrets.set", { name: "DESIGN_KEY", value: "fixture-design-value" });
  const notes = { command: process.execPath, args: [SERVER], env: { EXTRA_TOOL_FILE: path.join(dir.path, "extra") } };
  await env.client.call("mcp.set", { name: "notes", server: notes });
  await env.client.call("mcp.tools", { scope: "global", server: "notes" });
  await env.client.call("mcp.toolMode", { scope: "global", server: "notes", mode: "all" });
  // Saved again unchanged: its connection closes, so the list knows its tools only from the last time.
  await env.client.call("mcp.set", { name: "notes", server: notes });
  await env.client.call("mcp.set", {
    name: "design-kit",
    server: { url: "https://mcp.example.com/mcp", headers: { "x-api-key": "secret://DESIGN_KEY" } },
  });
  await env.client.call("mcp.toggle", { project: acme, server: "design-kit", on: false });
  return {
    env,
    northwind,
    url: env.core.url,
    clean: async () => {
      await page.goto("about:blank");
      await env.core.close();
      await env.cleanup();
      await dir.remove();
    },
  };
}

const row = (page: Page, name: string) =>
  page.locator(".apx-mdetail__list .apx-pickrow").filter({ has: page.getByText(name, { exact: true }) });

/** Each row's top and height: rows keep one size and never touch (a gap of at least 1px). */
async function rowsApart(rows: Locator) {
  const boxes = await rows.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).map((b) => [b.top, b.height]),
  );
  expect(boxes.length).toBeGreaterThan(1);
  for (let i = 1; i < boxes.length; i++) {
    const [top = 0] = boxes[i] ?? [];
    const [prevTop = 0, prevHeight = 0] = boxes[i - 1] ?? [];
    expect(top - (prevTop + prevHeight)).toBeGreaterThanOrEqual(1);
  }
  return boxes.map(([, h]) => h);
}

test("MCP rows tell tools, permissions and reach before a click; a server moves into a project", async ({
  page,
}, info) => {
  const { env, northwind, url, clean } = await fixture(page);
  try {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(`${url}/#view=resources`);
    await page.getByRole("radio", { name: /^MCP/ }).click();

    const notes = row(page, "notes");
    await expect(notes.getByText("2 tools", { exact: true })).toBeVisible();
    await expect(notes.getByRole("img", { name: "Permisos de tools: Todas permitidas" })).toBeVisible();
    await expect(notes.getByRole("img", { name: "Listo: arranca cuando un agente lo usa" })).toBeVisible();
    // Turned off in one of two projects: never "Global" as if it were everywhere.
    await expect(row(page, "design-kit").getByText("En 1 de 2", { exact: true })).toHaveAttribute(
      "title",
      "Apagado en: Acme",
    );
    const globalHeights = await rowsApart(page.locator(".apx-mdetail__list .apx-pickrow"));
    await page.screenshot({ path: info.outputPath("mcp-global.png") });

    await row(page, "design-kit").click();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Editar design-kit" });
    await dialog.getByRole("button", { name: "1 de 2 proyectos" }).click();
    await page.getByRole("menuitem", { name: "Acme", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("button", { name: "Todos los proyectos" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("mcp-dialog.png") });
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, "design-kit").getByText("Global", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Vive en" }).click();
    await page.getByRole("option", { name: "Northwind", exact: true }).click();
    await expect(dialog.getByText("Solo lo usan los agentes de Northwind.")).toBeVisible();
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(dialog).toBeHidden();
    const moved = (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "design-kit");
    expect(moved?.only).toBe(true);
    expect(moved?.project_id).toBe(northwind);
    await expect(row(page, "design-kit").getByText("Northwind", { exact: true })).toBeVisible();

    // Its variable opens Variables with it found.
    await page.getByRole("button", { name: /DESIGN_KEY/ }).click();
    await expect(page.getByRole("radio", { name: /^Variables/ })).toBeChecked();
    await expect(page.getByPlaceholder("Buscar variables…")).toHaveValue("DESIGN_KEY");

    // A project's list: its own and the inherited ones, the same rows as globally.
    await page.goto(`${url}/#project=${northwind}&tab=resources`);
    await page.getByRole("radio", { name: /^MCP/ }).click();
    await expect(row(page, "design-kit")).toBeVisible();
    const projectHeights = await rowsApart(page.locator(".apx-mdetail__list .apx-pickrow"));
    expect(projectHeights[0]).toBeCloseTo(globalHeights[0] ?? 0, 0);
    await page.screenshot({ path: info.outputPath("mcp-project.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(row(page, "notes")).toBeVisible();
    await page.screenshot({ path: info.outputPath("mcp-project-phone.png") });
  } finally {
    await clean();
  }
});
