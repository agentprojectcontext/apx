import fs from "node:fs";
import path from "node:path";
import { isInside, samePath } from "../../apps/core/src/paths.ts";
import type { DesktopInstallStatus } from "../../packages/protocol/src/desktop-install.ts";
import { expect, rpc, test, world } from "./kit.ts";

// The offer is a card in the deck at the foot of the compact sidebar.
test.use({ desktopInstallNotice: true, compactSidebar: true });

test("existing web users get one-click desktop installation, progress, reload recovery and retry", async ({ page }) => {
  let current: DesktopInstallStatus = { available: true, installed: false, phase: "idle", received: 0 };
  let starts = 0;
  let cancels = 0;
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
  await page.route("**/rpc/desktop.install_cancel", async (route) => {
    cancels++;
    current = { available: true, installed: false, phase: "idle", received: 0 };
    await route.fulfill({ json: { ok: true, result: current } });
  });
  await page.goto("/");
  const notice = page.locator('[data-card="desktop"]');
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Instalar y abrir" }).click();
  await expect(notice.getByRole("progressbar")).toHaveAttribute("value", "25");
  await expect(notice.getByRole("button", { name: "Más tarde" })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("desktop-download.png") });
  await expect(notice.getByRole("button", { name: "Cancelar" })).toBeVisible();
  await notice.getByRole("button", { name: "Cancelar" }).click();
  await expect(notice.getByRole("button", { name: "Instalar y abrir" })).toBeVisible();
  await expect(notice.getByRole("progressbar")).toHaveCount(0);
  expect(cancels).toBe(1);
  expect(starts).toBe(1);
  await notice.getByRole("button", { name: "Instalar y abrir" }).click();
  await expect(notice.getByRole("progressbar")).toHaveAttribute("value", "25");
  await page.reload();
  await expect(notice.getByRole("progressbar")).toHaveAttribute("value", "25");
  expect(starts).toBe(2);
  current = { ...current, phase: "failed", error: "Download interrupted" };
  await expect(notice.getByRole("alert")).toContainText("Download interrupted");
  await notice.getByRole("button", { name: "Reintentar" }).click();
  await expect(notice.getByRole("progressbar")).toBeVisible();
  expect(starts).toBe(3);
  statusError = true;
  await expect(notice).toContainText("Conexión interrumpida");
  statusError = false;
  await notice.getByRole("button", { name: "Reintentar" }).click();
  current = { ...current, installed: true, phase: "ready", received: 100 };
  await expect(notice).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir desktop", exact: true })).toBeVisible();
  expect(starts).toBe(3);
  await page.reload();
  await expect(notice).not.toBeVisible();
  expect(starts).toBe(3);
});

test("an installed app opens from above the account, while headless instances have no desktop action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  let opens = 0;
  await page.route("**/rpc/setup.status", (route) =>
    route.fulfill({ json: { ok: true, result: { done: true, fresh: false } } }),
  );
  await page.route("**/rpc/desktop.install_status", (route) =>
    route.fulfill({ json: { ok: true, result: { available: true, installed: true, phase: "idle", received: 0 } } }),
  );
  await page.route("**/rpc/desktop.install", (route) => {
    opens++;
    return route.fulfill({
      json: { ok: true, result: { available: true, installed: true, phase: "ready", received: 0 } },
    });
  });
  await page.goto("/");
  await expect(page.locator(".shell")).toBeVisible();
  await expect(page.locator(".desktop-install")).toHaveCount(0);
  const launch = page.locator(".desktop-launch").getByRole("button", { name: "Abrir desktop", exact: true });
  await expect(launch).toBeVisible();
  await expect(page.locator(".desktop-launch + .sidebar__foot")).toHaveCount(1);
  // The sidebar draws no lines: the launch row sits with the account, as one foot.
  await expect(page.locator(".desktop-launch")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".sidebar__foot")).toHaveCSS("border-top-width", "0px");
  await launch.click();
  await expect.poll(() => opens).toBe(1);
  await expect(page.locator(".desktop-install")).toHaveCount(0);
  await page.reload();
  await expect(launch).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("desktop-open-sidebar.png") });
  expect(opens).toBe(1);
  await page.unroute("**/rpc/desktop.install_status");
  await page.route("**/rpc/desktop.install_status", (route) =>
    route.fulfill({ json: { ok: true, result: { available: false, installed: false, phase: "idle", received: 0 } } }),
  );
  await page.reload();
  await expect(page.locator(".shell")).toBeVisible();
  await expect(page.locator(".desktop-install")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Abrir desktop", exact: true })).toHaveCount(0);
});

test("a pending start must be acknowledged before cancel", async ({ page }) => {
  let current: DesktopInstallStatus = { available: true, installed: false, phase: "idle", received: 0 };
  let requests = 0;
  let starts = 0;
  let cancels = 0;
  let releaseStart: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  await page.route("**/rpc/setup.status", (route) =>
    route.fulfill({ json: { ok: true, result: { done: true, fresh: false } } }),
  );
  await page.route("**/rpc/desktop.install_status", (route) => route.fulfill({ json: { ok: true, result: current } }));
  await page.route("**/rpc/desktop.install", async (route) => {
    requests++;
    if (requests === 1) await delayed;
    starts++;
    current = { ...current, phase: "downloading", received: 40, total: 100 };
    await route.fulfill({ json: { ok: true, result: current } });
  });
  await page.route("**/rpc/desktop.install_cancel", async (route) => {
    cancels++;
    current = { available: true, installed: false, phase: "idle", received: 0 };
    await route.fulfill({ json: { ok: true, result: current } });
  });
  try {
    await page.goto("/");
    const notice = page.locator('[data-card="desktop"]');
    await notice.getByRole("button", { name: "Instalar y abrir" }).click();
    await expect.poll(() => requests).toBe(1);
    // Cancel before the start was acknowledged does nothing.
    await notice.getByRole("button", { name: "Cancelar" }).click();
    expect(starts).toBe(0);
    expect(cancels).toBe(0);
    releaseStart?.();
    await expect(notice.getByRole("progressbar")).toHaveAttribute("value", "40");
    await expect(notice.getByRole("button", { name: "Cancelar" })).toBeEnabled();
    await notice.getByRole("button", { name: "Cancelar" }).click();
    await expect(notice.getByRole("button", { name: "Instalar y abrir" })).toBeVisible();
    expect(cancels).toBe(1);
    await notice.getByRole("button", { name: "Instalar y abrir" }).click();
    await expect(notice.getByRole("progressbar")).toHaveAttribute("value", "40");
    expect(starts).toBe(2);
    current = { ...current, phase: "installing" };
    await expect(notice.getByRole("button", { name: "Cancelar" })).toHaveCount(0);
    await expect(notice.getByRole("progressbar")).toBeVisible();
    current = { ...current, installed: true, phase: "ready" };
    await expect(notice).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir desktop", exact: true })).toBeVisible();
  } finally {
    releaseStart?.();
  }
});

test("dismissing the offer survives reload and the sidebar can start installation later", async ({ page }) => {
  let current: DesktopInstallStatus = { available: true, installed: false, phase: "idle", received: 0 };
  let starts = 0;
  await page.route("**/rpc/setup.status", (route) =>
    route.fulfill({ json: { ok: true, result: { done: true, fresh: false } } }),
  );
  await page.route("**/rpc/desktop.install_status", (route) => route.fulfill({ json: { ok: true, result: current } }));
  await page.route("**/rpc/desktop.install", (route) => {
    starts++;
    current = { ...current, phase: "downloading", received: 30, total: 100 };
    return route.fulfill({ json: { ok: true, result: current } });
  });
  await page.goto("/");
  const notice = page.locator('[data-card="desktop"]');
  await notice.getByRole("button", { name: "Más tarde" }).click();
  await expect(notice).not.toBeVisible();
  await page.reload();
  const install = page.locator(".desktop-launch").getByRole("button", { name: "Instalar y abrir", exact: true });
  await expect(install).toBeVisible();
  await expect(notice).not.toBeVisible();
  expect(starts).toBe(0);
  await install.click();
  await expect(notice.getByRole("progressbar")).toHaveAttribute("value", "30");
  expect(starts).toBe(1);
});

test("the desktop app never renders the web launcher or queries installation status", async ({ page }) => {
  let checks = 0;
  await page.addInitScript(() => {
    Object.defineProperty(window, "apxDesktop", { value: { platform: "darwin", coreLocal: true } });
  });
  await page.route("**/rpc/setup.status", (route) =>
    route.fulfill({ json: { ok: true, result: { done: true, fresh: false } } }),
  );
  await page.route("**/rpc/desktop.install_status", (route) => {
    checks++;
    return route.fulfill({
      json: { ok: true, result: { available: true, installed: true, phase: "idle", received: 0 } },
    });
  });
  await page.goto("/");
  await expect(page.locator(".shell")).toBeVisible();
  await expect(page.locator(".desktop-launch")).toHaveCount(0);
  await expect(page.locator(".desktop-install")).toHaveCount(0);
  expect(checks).toBe(0);
});

// See HISTORY.md#e2e-desktop-handoff.
test("Open desktop in the sandbox opens the sandbox's own app, saved on the sandbox's data", async ({ page }) => {
  await page.route("**/rpc/setup.status", (route) =>
    route.fulfill({ json: { ok: true, result: { done: true, fresh: false } } }),
  );
  const before = (await world.desktopApp()).opened.length;
  await page.goto("/");
  await page.locator(".desktop-launch").getByRole("button", { name: "Abrir desktop", exact: true }).click();
  await expect.poll(async () => (await world.desktopApp()).opened.length).toBe(before + 1);
  await expect.poll(async () => (await rpc<DesktopInstallStatus>("desktop.install_status")).phase).toBe("ready");

  const { dir, home, core } = await world.info();
  const { opened, connection } = await world.desktopApp();
  const launched = opened[before];
  expect(launched?.args).toContain("--apx-adopt-local");
  const sandbox = fs.realpathSync(dir);
  const apps = [launched?.command ?? "", ...(launched?.args ?? [])].filter((arg) => path.isAbsolute(arg));
  expect(apps.some((arg) => isInside(sandbox, fs.realpathSync(arg)))).toBe(true);
  expect(connection).toMatchObject({ mode: "local", port: Number(new URL(core).port) });
  expect(samePath(String(connection?.home), fs.realpathSync(home))).toBe(true);
});
