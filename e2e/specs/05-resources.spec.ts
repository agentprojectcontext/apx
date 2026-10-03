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
