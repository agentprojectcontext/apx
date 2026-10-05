// A newer APX: the pill shows only when there is one, lists what changed and updates on the owner's word; a newer
// panel on disk asks to reload; a server install offers the newer release, and the desktop app its own. The core's
// answers and the app's bridge are stood in for here (the sandbox touches neither git nor the release feed).
import type { Page, Route } from "@playwright/test";
import { expect, open, test } from "./kit.ts";

const answer = (page: Page, method: string, edit: (result: Record<string, unknown>) => unknown) =>
  page.route(`**/rpc/${method}`, async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { ok: boolean; result: Record<string, unknown> };
    await route.fulfill({ response: res, json: { ...body, result: edit(body.result) } });
  });

// A stood-in answer still in flight when a test ends must not fail it: its page is closing.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("no pill while APX is up to date", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: /^Actualización/ })).toBeHidden();
  await expect(page.getByRole("button", { name: /Recargar/ })).toBeHidden();
});

test("a newer APX: its changes, and Update now", async ({ page }) => {
  await answer(page, "system.updates", (r) => ({ ...r, source: "git", behind: 2, changes: ["feat: a", "fix: b"] }));
  await answer(page, "system.update", () => ({ ok: true, restart: false, log: "ok" }));
  await open(page);
  await page.getByRole("button", { name: "Actualización · 2" }).click();
  const dialog = page.getByRole("dialog", { name: "Hay una versión nueva de APX" });
  await expect(dialog.getByText("fix: b")).toBeVisible();
  await dialog.getByRole("button", { name: "Actualizar ahora" }).click();
  await expect(dialog.getByText("Listo. Reiniciá APX para usar la versión nueva.")).toBeVisible();
});

test("a newer panel on disk asks to reload", async ({ page }) => {
  await answer(page, "system.health", (r) => ({ ...r, panel: "index-NEWER000.js" }));
  await open(page);
  await expect(page.getByRole("button", { name: "Panel nuevo · Recargar" })).toBeVisible();
});

test("the quick window, with no top bar, loads a newer panel itself when shown again", async ({ page }) => {
  await page.goto("/?quick=1");
  await expect(page.locator("section.quick")).toBeVisible();
  await answer(page, "system.health", (r) => ({ ...r, panel: "index-NEWER000.js" }));
  const reloaded = page.waitForEvent("load");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reloaded;
});

test("a daemon installed from a bundle offers the newer release by its version", async ({ page }) => {
  await answer(page, "system.updates", (r) => ({
    ...r,
    source: "release",
    behind: 1,
    latest: "9.1.0",
    changes: ["feat: sidebar sections"],
  }));
  await answer(page, "system.update", () => ({ ok: true, restart: false, log: "installed" }));
  await open(page);
  await page.getByRole("button", { name: "APX 9.1.0 · Actualizar" }).click();
  const dialog = page.getByRole("dialog", { name: "Hay una versión nueva de APX" });
  await expect(dialog.getByText("Salió APX 9.1.0. Qué trae:")).toBeVisible();
  await expect(dialog.getByText("feat: sidebar sections")).toBeVisible();
  await dialog.getByRole("button", { name: "Actualizar ahora" }).click();
  await expect(dialog.getByText("Listo. Reiniciá APX para usar la versión nueva.")).toBeVisible();
});

/** The desktop app's bridge, as its preload exposes it, with a newer app out. */
const desktopWithUpdate = (page: Page, install: "auto" | "drag") =>
  page.addInitScript((mode) => {
    const w = window as unknown as Record<string, unknown>;
    w.installs = 0;
    w.apxDesktop = {
      platform: mode === "drag" ? "darwin" : "linux",
      setBrowserBounds: () => {},
      updateStatus: async () => ({ current: "9.0.0", latest: "9.1.0", notes: ["feat: app updates"], install: mode }),
      installUpdate: async () => {
        w.installs = Number(w.installs) + 1;
        return { ok: true, restarting: mode === "auto" };
      },
    };
  }, install);

test("the desktop app offers its own newer version and puts it in place", async ({ page }) => {
  await desktopWithUpdate(page, "auto");
  await open(page);
  await page.getByRole("button", { name: "APX 9.1.0 · Actualizar" }).click();
  const dialog = page.getByRole("dialog", { name: "Hay una versión nueva de APX" });
  await expect(dialog.getByText(/Salió APX 9\.1\.0 \(esta app es la 9\.0\.0\)/)).toBeVisible();
  await expect(dialog.getByText("feat: app updates")).toBeVisible();
  await dialog.getByRole("button", { name: "Actualizar ahora" }).click();
  await expect(dialog.getByText("Reiniciando APX con la versión nueva…")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { installs: number }).installs)).toBe(1);
});

test("on macOS the new app is downloaded and opened for the owner to drag in", async ({ page }) => {
  await desktopWithUpdate(page, "drag");
  await open(page);
  await page.getByRole("button", { name: "APX 9.1.0 · Actualizar" }).click();
  const dialog = page.getByRole("dialog", { name: "Hay una versión nueva de APX" });
  await dialog.getByRole("button", { name: "Descargar" }).click();
  await expect(dialog.getByText(/arrastralo a Aplicaciones/)).toBeVisible();
});
