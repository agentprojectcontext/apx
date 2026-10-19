import type { DesktopInstallStatus } from "../../packages/protocol/src/desktop-install.ts";
import { expect, test } from "./kit.ts";

test.use({ desktopInstallNotice: true });

test("existing web users get one-click desktop installation, progress, reload recovery and retry", async ({ page }) => {
  let current: DesktopInstallStatus = { available: true, installed: false, phase: "idle", received: 0 };
  let starts = 0;
  let statusError = false;
  await page.route("**/rpc/setup.status", (route) =>
    route.fulfill({ json: { ok: true, result: { done: true, fresh: false } } }),
  );
  await page.route("**/rpc/desktop.install_status", (route) =>
    route.fulfill({
      json: statusError
        ? { ok: false, error: { code: "unavailable", message: "connection interrupted" } }
        : { ok: true, result: current },
    }),
  );
  await page.route("**/rpc/desktop.install", async (route) => {
    starts++;
    current = { ...current, phase: "downloading", received: 25, total: 100, error: undefined };
    await route.fulfill({ json: { ok: true, result: current } });
  });
  await page.goto("/");
  const notice = page.getByRole("complementary", { name: "Usá APX como aplicación de escritorio" });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Instalar y abrir" }).click();
  await expect(notice.getByRole("progressbar")).toHaveAttribute("value", "25");
  await page.screenshot({ path: test.info().outputPath("desktop-download.png") });
  expect(starts).toBe(1);
  await page.reload();
  await expect(notice.getByRole("progressbar")).toHaveAttribute("value", "25");
  expect(starts).toBe(1);
  current = { ...current, phase: "failed", error: "Download interrupted" };
  await expect(notice.getByRole("alert")).toHaveText("Download interrupted");
  await notice.getByRole("button", { name: "Reintentar" }).click();
  await expect(notice.getByRole("progressbar")).toBeVisible();
  expect(starts).toBe(2);
  statusError = true;
  await expect(notice).toContainText("Conexión interrumpida");
  statusError = false;
  await notice.getByRole("button", { name: "Reintentar" }).click();
  current = { ...current, installed: true, phase: "ready", received: 100 };
  await expect(notice).toContainText("Aplicación instalada");
  expect(starts).toBe(2);
  await notice.getByRole("button", { name: "Cerrar" }).click();
  await expect(notice).not.toBeVisible();
});

test("installed and headless instances do not offer installation", async ({ page }) => {
  await page.route("**/rpc/desktop.install_status", (route) =>
    route.fulfill({ json: { ok: true, result: { available: true, installed: true, phase: "idle", received: 0 } } }),
  );
  await page.goto("/");
  await expect(page.locator(".shell")).toBeVisible();
  await expect(page.locator(".desktop-install")).toHaveCount(0);
  await page.unroute("**/rpc/desktop.install_status");
  await page.route("**/rpc/desktop.install_status", (route) =>
    route.fulfill({ json: { ok: true, result: { available: false, installed: false, phase: "idle", received: 0 } } }),
  );
  await page.reload();
  await expect(page.locator(".shell")).toBeVisible();
  await expect(page.locator(".desktop-install")).toHaveCount(0);
});
