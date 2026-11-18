// The add box: an extension from elsewhere (a folder) is looked at under the source picker, added (nothing runs),
// then connected in the same box with its key, its real tools shown; one with nothing to connect is ready on Add.
import fs from "node:fs";
import path from "node:path";
import { expect, open, openExtension, openExtensionSettings, rpc, test, world } from "./kit.ts";

const SERVER = path.resolve(import.meta.dirname, "../../apps/core/src/mcp/fake-server.test-support.mjs");

async function folder(name: string, manifest: Record<string, unknown>, listing?: Record<string, unknown>) {
  const { dir } = await world.info();
  const root = path.join(dir, "add-box", name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "apx-extension.json"), JSON.stringify(manifest));
  if (listing) fs.writeFileSync(path.join(root, "apx-listing.json"), JSON.stringify(listing));
  return root;
}

async function fromFolder(page: import("@playwright/test").Page, root: string) {
  await open(page);
  await page.getByRole("button", { name: "Marketplace", exact: true }).first().click();
  await page.getByRole("button", { name: "Avanzado" }).click();
  await page.getByRole("button", { name: "Desde una carpeta" }).click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Carpeta de la extensión").fill(root);
  await box.getByRole("button", { name: "Revisar" }).click();
  return box;
}

test("from a folder: looked at, added without running, then connected with its key in the same box", async ({
  page,
}) => {
  const root = await folder(
    "northwind-notes",
    {
      id: "northwind-notes",
      name: "Northwind Notes",
      version: "1.0.0",
      description: "Notes for the CRM.",
      mcp: { notes: { command: process.execPath, args: [SERVER], env: { NOTES_TOKEN: "secret://token" } } },
      secrets: [{ name: "token", label: "Notes token" }],
    },
    { schema: 2, summary: "Notes for the CRM.", tools: [{ name: "echo" }, { name: "token" }] },
  );
  const box = await fromFolder(page, root);
  await expect(box.getByText("Tuya")).toBeVisible();
  await expect(box.getByText("2 herramientas: echo y token.")).toBeVisible();
  await expect(box.getByText(/Corre un programa en tu compu\. No arranca hasta que la conectes\./)).toBeVisible();
  await box.getByRole("button", { name: "Agregar", exact: true }).click();

  // Added, still off: the same box asks for its key before it connects.
  await expect(box.getByRole("heading", { name: "Conectar Northwind Notes" })).toBeVisible();
  const added = (await rpc<{ extensions: Array<{ id: string; enabled: boolean }> }>("extensions.list")).extensions;
  expect(added.find((e) => e.id === "northwind-notes")?.enabled).toBe(false);
  await expect(box.getByRole("button", { name: "Conectar", exact: true })).toBeDisabled();
  await box.getByLabel("Notes token").fill("notes-e2e-token");
  await box.getByRole("button", { name: "Conectar", exact: true }).click();
  await expect(box.getByRole("heading", { name: "Northwind Notes está lista" })).toBeVisible({ timeout: 30_000 });
  await expect(box.getByRole("status").filter({ hasText: "Conectada" })).toBeVisible();
  // Past adding it the card is folded under the action; opened, it lists the tools its server answered with.
  await box.getByRole("button", { name: "Ver qué trae" }).click();
  await expect(box.getByText(/herramientas: echo y token/)).toBeVisible();
  await box.getByRole("button", { name: "Listo" }).click();
  await expect(box).toBeHidden();
});

test("one with nothing to connect is ready on Add", async ({ page }) => {
  const brief = path.resolve(import.meta.dirname, "../../examples/extensions/daily-brief");
  const box = await fromFolder(page, brief);
  await expect(box.getByText("Una rutina")).toBeVisible();
  await box.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(box.getByRole("heading", { name: "Daily brief está lista" })).toBeVisible();
  await box.getByRole("button", { name: "Listo" }).click();
  await expect(box).toBeHidden();
});

test("its settings keep each part apart: the keys, reading it again and trying it", async ({ page }, info) => {
  const root = await folder("northwind-desk", {
    id: "northwind-desk",
    name: "Northwind Desk",
    version: "1.0.0",
    description: "The help desk.",
    mcp: { desk: { command: process.execPath, args: [SERVER], env: { DESK_TOKEN: "secret://token" } } },
    secrets: [{ name: "token", label: "Desk token" }],
  });
  await rpc("extensions.install", { path: root });
  await rpc("extensions.set_secret", { id: "northwind-desk", name: "token", value: "desk-e2e-token" });
  await rpc("extensions.enable", { id: "northwind-desk", enabled: true });
  await open(page);
  await openExtension(page, "Northwind Desk");
  const dialog = await openExtensionSettings(page);
  const parts = dialog.locator(".mkt-settings > section");
  await expect(parts).toHaveCount(3);
  await expect(parts.nth(0)).toContainText("Sus claves");
  await expect(parts.nth(1)).toContainText(root);
  await expect(parts.nth(2).getByRole("button", { name: "Probar" })).toBeVisible();
  // The folder's path wraps: nothing in the dialog scrolls sideways.
  const body = dialog.locator(".mkt-settings");
  expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.screenshot({ path: info.outputPath("extension-settings.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(parts.nth(0).getByRole("button", { name: "Borrar" })).toBeInViewport({ ratio: 1 });
  await dialog.screenshot({ path: info.outputPath("extension-settings-phone.png") });
});
