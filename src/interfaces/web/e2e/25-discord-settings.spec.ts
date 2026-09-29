import { test, expect } from "./fixtures";

// Settings → Discord. Mostly read-only: under `pnpm e2e` these specs drive the
// developer's REAL daemon (see README), and a spec that saved a token or listed
// a room would be editing the owner's actual bot. The one write below — the
// "only me" switch — puts the value back the way it found it, and under the
// gate (`npm run e2e:gate`) it runs on a throwaway APX_HOME anyway. The rest of
// writing is covered by tests/discord-api.test.js against an isolated home.
test.describe("discord settings", () => {
  test("is reachable from the settings nav and survives a reload", async ({ page, errors }) => {
    await page.goto("/settings");
    await page.getByTestId("tabnav-discord").click();
    await expect(page).toHaveURL(/\/settings\/discord/);
    await expect(page.getByTestId("discord-panel")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("discord-panel")).toBeVisible();
    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("shows the connection state and the room list", async ({ page }) => {
    await page.goto("/settings/discord");
    await expect(page.getByTestId("discord-state")).toBeVisible();
    await expect(page.getByTestId("discord-channels")).toBeVisible();
  });

  test("never renders a token back into the page", async ({ page }) => {
    await page.goto("/settings/discord");
    await expect(page.locator('input[type="password"]')).toHaveValue("");
  });

  test("'only me' is a switch that saves, survives a reload, and says what it means", async ({ page, errors }) => {
    await page.goto("/settings/discord");
    const box = page.getByTestId("discord-owner-only").getByRole("switch");
    await expect(box).toBeVisible();
    const was = (await box.getAttribute("aria-checked")) === "true";
    const flip = async (to: boolean) => {
      if (((await box.getAttribute("aria-checked")) === "true") !== to) await box.click();
      await page.getByTestId("discord-save").click();
      await expect.poll(async () => {
        const r = await page.request.get("/api/discord/status", {
          headers: { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("apx.token"))}` },
        });
        return (await r.json()).owner_only === true;
      }).toBe(to);
    };
    try {
      await flip(!was);
      await page.reload();
      await expect(page.getByTestId("discord-owner-only").getByRole("switch")).toHaveAttribute("aria-checked", String(!was));
    } finally {
      await flip(was);
    }
    expect(errors).toEqual([]);
  });
});
