// Usage: the topbar gauge opens a compact view of memory, CPU, disk, the VM and APX's top consumers; the full dialog
// comes from it, from the account menu and, on a narrow window, from the "more" menu. The e2e core has a fake VM on.
import { expect, open, rpc, test } from "./kit.ts";

test("the topbar gauge opens memory, CPU, disk, the VM and APX's top consumers, and the full dialog from there", async ({
  page,
}) => {
  await rpc("setup.finish");
  await page.addInitScript(() => {
    Object.assign(window, {
      apxDesktop: {
        setBrowserBounds() {},
        memory: async () => ({
          total_mb: 900,
          items: [
            { pid: 2, kind: "panel", mb: 520 },
            { pid: 3, kind: "tab", site: "example.com", mb: 380 },
          ],
        }),
      },
    });
  });
  await open(page);
  await page.getByRole("button", { name: /^Consumo: \d+% de la memoria en uso$/ }).click();
  const summary = page.getByTestId("usage-summary");
  await expect(summary.getByRole("heading", { name: "Memoria" })).toBeVisible();
  await expect(summary.getByRole("heading", { name: "CPU" })).toBeVisible();
  await expect(summary.getByText(/libres de/)).toBeVisible();
  await expect(summary.getByTestId("usage-vm")).toContainText("Encendida");
  await expect(summary.getByTestId("usage-vm")).toContainText("1.5 GB de 4.0 GB de memoria");
  await expect(summary.getByText("Panel", { exact: true })).toBeVisible();
  await expect(summary.getByText("Pestaña del navegador · example.com")).toBeVisible();
  await expect(summary.getByText("Core (agentes, canales, datos)")).toBeVisible();

  await summary.getByRole("button", { name: "Ver todo el consumo" }).click();
  const dialog = page.getByRole("dialog", { name: "Consumo" });
  await expect(dialog.getByRole("heading", { name: "Procesos de APX" })).toBeVisible();
  // The APX folder is measured in the background: its parts come on a later read.
  await expect(dialog.getByTestId("usage-home").getByText("Bases de datos")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText(/Volumen (del sistema|de la carpeta de APX)/).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar" }).last().click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Consumo" }).click();
  await expect(page.getByRole("dialog", { name: "Consumo" }).getByTestId("usage-detail")).toBeVisible();
});

test("on a narrow window the gauge folds into the more menu, which opens the dialog", async ({ page }) => {
  await rpc("setup.finish");
  await page.setViewportSize({ width: 600, height: 800 });
  await open(page);
  await expect(page.getByTestId("usage-button")).toBeHidden();
  await page.getByRole("button", { name: "Más opciones" }).click();
  await page.getByRole("menuitem", { name: "Consumo" }).click();
  await expect(page.getByRole("dialog", { name: "Consumo" }).getByTestId("usage-detail")).toBeVisible();
});
