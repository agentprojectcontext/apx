// The corner cards: a newer release, the Discord and a star on GitHub, one at a time, each said once per device (the
// update card again each time APX opens, until it is updated). The core's update answer is stood in for (the sandbox never asks the release feed).
import type { Route } from "@playwright/test";
import { expect, open, test } from "./kit.ts";

test.use({ cornerCards: true });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("one card at a time: closing one brings the next, and closed stays closed", async ({ page }) => {
  await open(page);
  const corner = page.getByRole("complementary", { name: "Novedades e invitaciones" });
  await expect(corner.getByText("Sumate a la comunidad")).toBeVisible();
  // The star card waits behind, out of reach.
  await expect(corner.getByRole("button", { name: "Dar una estrella" })).not.toBeInViewport({ ratio: 1 });

  await corner.locator('[data-card="discord"]').getByRole("button", { name: "Cerrar" }).click();
  await expect(corner.getByText("Sumate a la comunidad")).toBeHidden();
  await expect(corner.getByText("¿Te gusta APX?")).toBeVisible();

  await page.reload();
  await expect(corner.getByText("¿Te gusta APX?")).toBeVisible();
  await expect(corner.getByText("Sumate a la comunidad")).toBeHidden();

  // Acting on it is enough: the repo opens in a new tab and the card does not come back.
  const popup = page.waitForEvent("popup");
  await page.context().route("https://github.com/**", (route) => route.fulfill({ body: "ok" }));
  await corner.getByRole("button", { name: "Dar una estrella" }).click();
  expect((await popup).url()).toContain("github.com/agentprojectcontext/apx");
  await expect(corner).toBeHidden();
});

test("a newer release goes first, opens the update dialog, and once closed comes back when APX opens again", async ({
  page,
}) => {
  let latest = "9.1.0";
  await page.route("**/rpc/system.updates", async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { ok: boolean; result: Record<string, unknown> };
    await route.fulfill({
      response: res,
      json: { ...body, result: { ...body.result, source: "release", behind: 1, latest, changes: ["feat: a"] } },
    });
  });
  await open(page);
  const card = page.locator('[data-card="update"]');
  await expect(card.getByText("Salió APX 9.1.0")).toBeVisible();
  await card.getByRole("button", { name: "Ver novedades" }).click();
  const dialog = page.getByRole("dialog", { name: "Hay una versión nueva de APX" });
  await expect(dialog.getByText("feat: a")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Closed, it leaves for now: the next card comes forward.
  await card.getByRole("button", { name: "Cerrar" }).click();
  await expect(card).toBeHidden();
  await expect(page.getByText("Sumate a la comunidad")).toBeVisible();
  // An update left for later is said again the next time APX opens.
  await page.reload();
  await expect(card.getByText("Salió APX 9.1.0")).toBeVisible();

  latest = "9.2.0";
  await page.reload();
  await expect(card.getByText("Salió APX 9.2.0")).toBeVisible();
});
