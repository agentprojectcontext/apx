import fs from "node:fs";
import path from "node:path";
import { ErrorCode } from "../../packages/protocol/src/constants.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

test.use({
  expectedConsoleErrors: [
    {
      path: "/rpc/extensions.enable",
      text: "Failed to load resource: the server responded with a status of 409 (Conflict)",
    },
  ],
});

for (const language of ["en", "es"] as const) {
  test(`a failed rollback refreshes the state and preserves entered fields, ${language}`, async ({ page }) => {
    const { dir } = await world.info();
    const id = `acme-recovery-${language}`;
    const name = `Acme recovery ${language}`;
    const root = path.join(dir, id);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "apx-extension.json"),
      JSON.stringify({
        id,
        name,
        version: "1.0.0",
        secrets: [{ name: "token", label: "API key" }],
        mcp: { main: { command: "node", args: ["./server.mjs"] } },
      }),
    );
    fs.writeFileSync(path.join(root, "server.mjs"), 'throw new Error("Cannot start");');
    const seen = await rpc<{ hash: string }>("extensions.inspect", { path: root });
    await rpc("extensions.install", { path: root, hash: seen.hash });
    let rollbackFailed = false;
    let readBacks = 0;
    // Only the compensating disable fails; all reads and the real server startup use the sandbox core.
    await page.route("**/rpc/**", async (route) => {
      const method = new URL(route.request().url()).pathname.split("/").at(-1);
      const params = route.request().postDataJSON() as { rollback_token?: string };
      if (method === "extensions.enable" && params.rollback_token) {
        rollbackFailed = true;
        await route.fulfill({
          status: 409,
          json: { ok: false, error: { code: ErrorCode.Conflict, message: "Unable to turn off" } },
        });
        return;
      }
      if (rollbackFailed && method === "extensions.list") readBacks++;
      await route.continue();
    });
    await page.addInitScript((language) => localStorage.setItem("apx.prefs", JSON.stringify({ language })), language);
    await open(page);
    await page.getByRole("button", { name: "Marketplace", exact: true }).first().click();
    await page.getByRole("button", { name, exact: true }).click();
    const connect = language === "en" ? "Connect" : "Conectar";
    await page.getByRole("button", { name: connect, exact: true }).click();
    const box = page.getByRole("dialog");
    const input = box.getByLabel("API key");
    await input.fill("example-token");
    await box.getByRole("button", { name: connect, exact: true }).click();
    await expect(box.getByRole("alert")).toContainText(
      language === "en"
        ? "The connection failed. We could not confirm it is off. Check its current status before trying again."
        : "La conexión falló. No pudimos confirmar que esté apagada. Revisá su estado actual antes de volver a intentar.",
    );
    await expect(input).toHaveValue("example-token");
    await expect(
      box.getByRole("button", { name: language === "en" ? "View status" : "Ver estado", exact: true }),
    ).toBeVisible();
    await expect(
      box.getByRole("button", { name: language === "en" ? "Try again" : "Probar de nuevo", exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => readBacks).toBeGreaterThan(0);
    expect(rollbackFailed).toBe(true);
    const listed = await rpc<{ extensions: Array<{ id: string; enabled: boolean }> }>("extensions.list");
    expect(listed.extensions.find((extension) => extension.id === id)?.enabled).toBe(true);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(input).toHaveValue("example-token");
      await page.screenshot({ path: test.info().outputPath(`rollback-${width}.png`), fullPage: true });
    }
    await box.getByRole("button", { name: language === "en" ? "View status" : "Ver estado", exact: true }).click();
    await expect(box).toBeHidden();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  });
}
