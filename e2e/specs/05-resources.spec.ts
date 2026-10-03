// Resources: the variable imported from v1, a new one revealed with the eye; an integration connected and removed.
import { expect, open, rpc, test } from "./kit.ts";

test("variables: the imported one is listed, a new one is saved and shown with the eye", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Variables/ }).click();
  await expect(page.getByText("NORTHWIND_API")).toBeVisible();
  await expect(page.getByText("nw-e2e-value")).toBeHidden();

  await page.getByRole("button", { name: "Variable", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("ACME_KEY");
  await dialog.getByLabel("Valor").fill("acme-e2e-secret");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("ACME_KEY")).toBeVisible();
  await expect(page.getByText("acme-e2e-secret")).toBeHidden();
  await page.getByRole("button", { name: "Ver el valor de ACME_KEY" }).click();
  await expect(page.getByText("acme-e2e-secret")).toBeVisible();
  await page.getByRole("button", { name: "Ocultar el valor de ACME_KEY" }).click();
  await expect(page.getByText("acme-e2e-secret")).toBeHidden();
});

test("a new MCP server takes a variable for its token from the + list, or a new one created right there", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^MCP/ }).click();
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo servidor MCP" });
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("northwind");
  await dialog.getByRole("textbox", { name: "Comando" }).fill("npx -y @acme/mcp-server");
  // An env key is written as an env name.
  await dialog.getByRole("textbox", { name: "Clave" }).fill("api token");
  await expect(dialog.getByRole("textbox", { name: "Clave" })).toHaveValue("API_TOKEN");
  await dialog.getByRole("button", { name: "Usar una variable" }).click();
  await page.getByRole("button", { name: "Crear nueva variable…" }).click();
  const create = page.getByRole("dialog", { name: "Nueva variable" });
  await create.getByRole("textbox", { name: "Nombre" }).fill("northwind token");
  await expect(create.getByRole("textbox", { name: "Nombre" })).toHaveValue("NORTHWIND_TOKEN");
  await create.getByLabel("Valor").fill("nw-mcp-secret");
  await create.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog.getByRole("textbox", { name: "Valor" })).toHaveValue("secret://NORTHWIND_TOKEN");

  await dialog.getByRole("button", { name: "Agregar fila" }).click();
  await dialog.getByRole("textbox", { name: "Clave" }).nth(1).fill("REGION");
  await dialog.getByRole("button", { name: "Usar una variable" }).nth(1).click();
  await page.getByRole("option", { name: "NORTHWIND_API" }).click();
  await expect(dialog.getByRole("textbox", { name: "Valor" }).nth(1)).toHaveValue("secret://NORTHWIND_API");

  await dialog.getByRole("button", { name: "Crear" }).click();
  await expect(dialog).toBeHidden();
  // The definition names its variables; the value stays in the secret store.
  const servers = (
    await rpc<{ servers: Array<{ name: string; vars: Array<{ name: string; set: boolean }> }> }>("mcp.list")
  ).servers;
  const northwind = servers.find((s) => s.name === "northwind");
  expect(northwind?.vars).toEqual(
    expect.arrayContaining([
      { name: "NORTHWIND_TOKEN", set: true },
      { name: "NORTHWIND_API", set: true },
    ]),
  );
  expect(JSON.stringify(servers)).not.toContain("nw-mcp-secret");
  await rpc("mcp.set", { name: "northwind", server: null });
});

test("integrations: GitHub is connected with a token, then disconnected", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("radio", { name: /^Integraciones/ }).click();
  await page
    .getByRole("button", { name: /Conectar nueva|Integración/ })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /GitHub/ })
    .click();
  await page.getByRole("dialog").getByLabel(/token/i).fill("ghp_e2e000000000");
  await page.getByRole("dialog").getByRole("button", { name: "Conectar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("GitHub").first()).toBeVisible();
  const servers = (await rpc<{ servers: Array<{ name: string }> }>("mcp.list")).servers;
  expect(servers.some((s) => s.name === "github")).toBe(true);
  expect(JSON.stringify(servers)).not.toContain("ghp_e2e000000000");

  await page.getByRole("button", { name: "Desconectar" }).click();
  await expect.poll(async () => (await rpc<{ servers: Array<{ name: string }> }>("mcp.list")).servers.length).toBe(0);
});
