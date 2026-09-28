import { test, expect } from "./fixtures";

// Settings → Discord. Read-only on purpose: these specs run against the REAL
// daemon (see README), and the Discord settings are global — a spec that saved
// a token or listed a room would be editing the owner's actual bot. Writing is
// covered by tests/discord-api.test.js against an isolated home.
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
});
