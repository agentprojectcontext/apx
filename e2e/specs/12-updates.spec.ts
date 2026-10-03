// A newer APX: the pill shows only when there is one, lists what changed and updates on the owner's word; a newer
// panel on disk asks to reload. The core's answers are stood in for here (the sandbox does not touch git).
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
