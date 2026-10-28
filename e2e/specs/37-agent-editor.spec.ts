// The agent editor: an area created on the spot, an agent marked orchestrator from its menu, a rule changed away from
// the project's after a warning, and the tools list searched.
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

const server = path.resolve("apps/core/src/mcp/fake-server.test-support.mjs");

test("the editor creates an area, takes its own rules after a warning, and searches tools", async ({ page }) => {
  await rpc("setup.finish", {});
  await rpc("projects.update_base", { kind: "company" });
  await rpc("agents.create", { slug: "ledger", name: "Ledger", role: "Bookkeeper" });
  await open(page, "#project=~default&tab=team");

  // The menu marks it as the one that runs the team.
  await page.locator(".teamcanvas__node", { hasText: "Ledger" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Orquestador" }).click();
  await expect
    .poll(async () => (await rpc<{ agent: { orchestrator?: boolean } }>("agents.get", { agent: "ledger" })).agent)
    .toMatchObject({ orchestrator: true });

  await page.locator(".teamcanvas__node", { hasText: "Ledger" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const editor = page.getByRole("dialog", { name: "Editar a Ledger" });

  await editor.getByRole("combobox", { name: "Área" }).click();
  await page.getByRole("option", { name: "Nueva área…" }).click();
  const area = page.getByRole("dialog", { name: "Nueva área" });
  await area.getByLabel("Área").fill("Finanzas");
  await area.getByRole("button", { name: "Crear" }).click();
  await expect(editor.getByRole("combobox", { name: "Área" })).toHaveText(/Finanzas/);

  // It followed the project's autonomy: changing one rule warns that it now keeps that mode as its own.
  await editor.getByRole("button", { name: "Reglas por caso" }).click();
  await editor.getByRole("radio", { name: "Apagada" }).last().click();
  const warn = page.getByRole("dialog", { name: "¿Dejar de usar las reglas del proyecto?" });
  await warn.getByRole("button", { name: "Usar reglas propias" }).click();
  await expect(editor.getByText(/Usa reglas propias/)).toBeVisible();

  await editor.getByRole("button", { name: "Tools" }).click();
  await editor.getByRole("searchbox", { name: "Buscar tools" }).fill("browser_cl");
  await expect(editor.getByText("browser_click")).toBeVisible();
  await expect(editor.getByText("file_read")).toHaveCount(0);

  await editor.getByRole("button", { name: "Guardar y cerrar" }).click();
  await expect(editor).toHaveCount(0);
  const ledger = await rpc<{ agent: { area?: string; autonomy?: string; rules?: Record<string, string> } }>(
    "agents.get",
    {
      agent: "ledger",
    },
  );
  expect(ledger.agent.area).toBe("finanzas");
  // The project's mode becomes its own and only the changed case is a rule, so every other case acts as that mode runs
  // (DECISIONS.md#d-090).
  expect(ledger.agent.autonomy).toBe("auto");
  expect(ledger.agent.rules).toEqual({ irreversible: "off" });

  // Back to how other specs expect it.
  await rpc("agents.archive", { agent: "ledger" });
  await rpc("org.set", { organization: { areas: [], roles: [] } });
  await rpc("projects.update_base", { kind: null });
});

test("the granted page searches by tool, server and condition, and says when nothing matches", async ({ page }) => {
  await rpc("setup.finish", {});
  await rpc("agents.create", { slug: "granter", name: "Granter" });
  await rpc("mcp.set", { name: "grantsearch", server: { command: process.execPath, args: [server] } });
  const keys: string[] = [];
  try {
    for (const tool of ["echo", "token"])
      await rpc("mcp.approveTool", { scope: "global", server: "grantsearch", tool });
    const { approvals } = await rpc<{
      approvals: Array<{ key: string; server: string; tool: string; agent_id?: string }>;
    }>("tools.approvals");
    const mine = approvals.filter((a) => a.server.includes("grantsearch") && !a.agent_id);
    keys.push(...mine.map((a) => a.key));
    const echo = mine.find((a) => a.tool === "echo");
    await rpc("tools.grant_set", { key: echo?.key, condition: "github.com" });

    await open(page, "#project=~default&tab=team");
    await page.locator(".teamcanvas__node", { hasText: "Granter" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Editar" }).click();
    const editor = page.getByRole("dialog", { name: "Editar a Granter" });
    await editor.getByRole("button", { name: /^Concedidos/ }).click();
    const search = editor.getByRole("searchbox", { name: "Buscar tools concedidas" });
    const row = (tool: string) =>
      editor.locator(".agentedit__grant").filter({ has: page.getByText(tool, { exact: true }) });

    await search.fill("tok");
    await expect(row("token")).toBeVisible();
    await expect(row("echo")).toHaveCount(0);
    // The condition is searched too.
    await search.fill("github");
    await expect(row("echo")).toBeVisible();
    await expect(row("token")).toHaveCount(0);
    await search.fill("grantsearch");
    await expect(row("echo")).toBeVisible();
    await expect(row("token")).toBeVisible();
    await search.fill("no-such-grant");
    await expect(editor.getByText("Nada concedido coincide con “no-such-grant”.")).toBeVisible();
    await expect(editor.locator(".agentedit__grant")).toHaveCount(0);
    await search.fill("");
    await expect(row("token")).toBeVisible();
  } finally {
    for (const key of keys) await rpc("tools.revoke", { key });
    await rpc("mcp.set", { name: "grantsearch", server: null });
    await rpc("agents.archive", { agent: "granter" });
  }
});
