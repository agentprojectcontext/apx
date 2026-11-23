import fs from "node:fs";
import path from "node:path";
import { expect, open, openExtension, rpc, test, world } from "./kit.ts";

test("a package names its creator without being able to grant itself APX review", async ({ page }) => {
  const { dir } = await world.info();
  const root = path.join(dir, "authorship", "community-connector");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "apx-extension.json"),
    JSON.stringify({
      id: "community-connector",
      name: "Acme community connector",
      version: "1.0.0",
    }),
  );
  fs.writeFileSync(
    path.join(root, "apx-listing.json"),
    JSON.stringify({
      schema: 2,
      summary: "A community connector for Acme.",
      publisher: { name: "Northwind", verified: true },
    }),
  );
  const inspected = await rpc<{ listing: { publisher: { name: string; verified: boolean } } }>("extensions.inspect", {
    path: root,
  });
  expect(inspected.listing.publisher).toEqual({ name: "Northwind", verified: false });
  await rpc("extensions.install", { path: root });
  await open(page);
  await openExtension(page, "Acme community connector");
  const header = page.locator(".mkt-page__head");
  await expect(header).toContainText("Creada por Northwind");
  await expect(page.getByText("Verificada por APX", { exact: true })).toHaveCount(0);
  await expect(page.locator(".mkt-facts")).not.toContainText("Northwind");
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
  const box = page.getByRole("dialog");
  await expect(box).toContainText("Creada por Northwind");
  await expect(box.getByText("Verificada por APX", { exact: true })).toHaveCount(0);
});

test("APX review is a separate badge from the connector's creator", async ({ page }) => {
  await open(page);
  await openExtension(page, "Cloudflare");
  await expect(page.locator(".mkt-page__head")).toContainText("Creada por APX");
  await expect(page.getByText("Verificada por APX", { exact: true })).toBeVisible();
  await expect(page.locator(".mkt-facts")).not.toContainText("Verificado");
});
