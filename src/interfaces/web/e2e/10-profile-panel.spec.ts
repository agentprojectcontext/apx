import { test, expect } from "./fixtures";

// The panel's most important job is telling the truth about a vanilla install:
// with no agent profile active, APX behaves exactly as it always has, and the
// screen has to say so rather than looking broken or empty-by-accident.
test.describe("agent profile panel", () => {
  test("is reachable from the settings nav", async ({ page, errors }) => {
    await page.goto("/settings/profile");
    await expect(page.getByTestId("profile-panel")).toBeVisible();
    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("explains the vanilla state instead of showing an empty screen", async ({ page }) => {
    await page.goto("/settings/profile");
    // A clean daemon has no profile active. The hint is what stops the empty
    // list from reading as a failure.
    await expect(page.getByTestId("profile-vanilla-hint")).toBeVisible();
  });

  test("survives a reload on its own URL (SPA route is registered)", async ({ page, errors }) => {
    await page.goto("/settings/profile");
    await page.reload();
    await expect(page.getByTestId("profile-panel")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the nav item sits with the agent settings, not the modules", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("tabnav-profile")).toBeVisible();
    await page.getByTestId("tabnav-profile").click();
    await expect(page).toHaveURL(/\/settings\/profile/);
    await expect(page.getByTestId("profile-panel")).toBeVisible();
  });
});
