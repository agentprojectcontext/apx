import { ErrorCode } from "../../packages/protocol/src/constants.ts";
import { expect, open, rpc, test } from "./kit.ts";

test.use({
  expectedConsoleErrors: [
    {
      path: "/rpc/extensions.enable",
      text: "Failed to load resource: the server responded with a status of 409 (Conflict)",
    },
  ],
});

test("an address connector with uncertain rollback opens its current status", async ({ page }) => {
  let rollbackFailed = false;
  let reads = 0;
  let installedId = "";
  await page.route("**/rpc/**", async (route) => {
    const method = new URL(route.request().url()).pathname.split("/").at(-1);
    const params = route.request().postDataJSON() as { rollback_token?: string; server?: string };
    if (method === "extensions.install") {
      const response = await route.fetch();
      const body = (await response.json()) as { result: { id: string } };
      installedId = body.result.id;
      await route.fulfill({ response });
      return;
    }
    if (method === "mcp.signIn") {
      await route.fulfill({
        json: {
          ok: true,
          result: { server: { scope: "global", name: params.server, status: "error", tool_names: [] } },
        },
      });
      return;
    }
    if (method === "extensions.enable" && params.rollback_token) {
      rollbackFailed = true;
      await route.fulfill({
        status: 409,
        json: { ok: false, error: { code: ErrorCode.Conflict, message: "Unable to turn off" } },
      });
      return;
    }
    if (rollbackFailed && method === "extensions.list") reads++;
    await route.continue();
  });
  await page.addInitScript(() => localStorage.setItem("apx.prefs", JSON.stringify({ language: "es" })));
  await open(page);
  await page.getByRole("button", { name: "Marketplace", exact: true }).first().click();
  await page.getByRole("button", { name: "Agregar", exact: true }).first().click();
  await page.getByRole("menuitem", { name: /Desde una dirección/ }).click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Dirección").fill("https://mcp.northwind.example/mcp");
  await box.getByRole("button", { name: "Revisar" }).click();
  await box.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(box.getByRole("alert")).toContainText("No pudimos confirmar que esté apagada");
  await expect(box.getByRole("button", { name: "Probar de nuevo", exact: true })).toHaveCount(0);
  await expect.poll(() => reads).toBeGreaterThan(0);
  expect(rollbackFailed).toBe(true);
  const listed = await rpc<{ extensions: Array<{ id: string; name: string; enabled: boolean }> }>("extensions.list");
  expect(installedId).not.toBe("");
  const extension = listed.extensions.find((entry) => entry.id === installedId);
  expect(extension?.enabled).toBe(true);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: test.info().outputPath("address-recovery-390.png"), fullPage: true });
  await box.getByRole("button", { name: "Ver estado", exact: true }).click();
  await expect(box).toBeHidden();
  await expect(page.getByRole("heading", { name: extension?.name, exact: true })).toBeVisible();
});
