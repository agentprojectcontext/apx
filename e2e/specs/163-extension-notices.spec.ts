import fs from "node:fs";
import path from "node:path";
import { expect, open, openExtension, openExtensionSettings, rpc, test, world } from "./kit.ts";

test("notices are opt-in, save quiet hours and a personal destination, and stay off after reconnecting", async ({
  page,
}, info) => {
  const { dir } = await world.info();
  const root = path.join(dir, "notice-extension");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "apx-extension.json"),
    JSON.stringify({
      id: "northwind-events",
      name: "Northwind Events",
      version: "1.0.0",
      events: [{ name: "completed", description: "A cycle completed" }],
    }),
  );
  await rpc("extensions.install", { path: root });
  await rpc("extensions.enable", { id: "northwind-events", enabled: true });
  const initial = await rpc<{ config: { enabled: boolean } | null }>("extensions.events_get", {
    id: "northwind-events",
  });
  expect(initial.config?.enabled ?? false).toBe(false);
  await rpc("extensions.events_set", {
    id: "northwind-events",
    config: { enabled: false, thread: "home", quiet_start: 0, quiet_end: 0, time_zone: "Europe/Madrid" },
  });
  await open(page);
  await openExtension(page, "Northwind Events");
  let dialog = await openExtensionSettings(page);
  await expect(dialog.getByRole("checkbox", { name: "Enviar avisos", exact: true })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: "Enviar avisos", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "Retener avisos en horarios de silencio" }).click();
  await dialog.getByLabel("Silencio desde").fill("00:00");
  await dialog.getByLabel("Hasta", { exact: true }).fill("08:00");
  await dialog.getByRole("combobox", { name: "Zona horaria" }).click();
  const search = page.getByRole("combobox", { expanded: true }).last();
  await search.fill("Invalid/Zone");
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("UTC");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "Zona horaria" })).toContainText("UTC");
  const beforeSave = await rpc<{ config: { enabled: boolean } | null }>("extensions.events_get", {
    id: "northwind-events",
  });
  expect(beforeSave.config?.enabled ?? false).toBe(false);
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Configuración de avisos guardada.");
  const result = await rpc<{
    config: { enabled: boolean; thread: string; quiet_start: number; quiet_end: number; time_zone: string };
  }>("extensions.events_get", { id: "northwind-events" });
  expect(result.config).toEqual({ enabled: true, thread: "home", quiet_start: 0, quiet_end: 480, time_zone: "UTC" });
  await dialog.screenshot({ path: info.outputPath("extension-notices-desktop.png") });
  await dialog.getByRole("button", { name: "Recargar configuración" }).click();
  await expect(dialog.getByLabel("Silencio desde")).toHaveValue("00:00");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.screenshot({ path: info.outputPath("extension-notices-phone.png") });
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).last().click();
  await rpc("extensions.enable", { id: "northwind-events", enabled: false });
  await rpc("extensions.enable", { id: "northwind-events", enabled: true });
  await open(page);
  await page.getByRole("button", { name: "Marketplace", exact: true }).first().click();
  // The tab carries a count when an extension waits on the owner (another spec may leave one).
  await page.getByRole("button", { name: /^Tus extensiones(\s+\d+)?$/ }).click();
  await page
    .getByRole("main")
    .getByRole("button", { name: /^Northwind Events/ })
    .first()
    .click();
  await page.getByRole("main").getByRole("button", { name: "Más opciones", exact: true }).click();
  await page.getByRole("menuitem", { name: "Configuración", exact: true }).click();
  dialog = page.getByRole("dialog", { name: /^Configuración de / });
  await expect(dialog.getByRole("checkbox", { name: "Enviar avisos", exact: true })).not.toBeChecked();
});
