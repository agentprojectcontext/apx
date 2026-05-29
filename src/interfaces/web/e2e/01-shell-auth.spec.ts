import { test, expect } from "./fixtures";

test.describe("shell & auth", () => {
  test("boots authenticated and lands on the admin screen", async ({ page, errors }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("screen-admin")).toBeVisible();
    expect(errors, "no uncaught page errors on boot").toEqual([]);
  });

  test("sidebar rail exposes home, settings and add-project", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-home")).toBeVisible();
    await expect(page.getByTestId("nav-settings")).toBeVisible();
    await expect(page.getByTestId("nav-add-project")).toBeVisible();
    // Base (id=0) project is always pinned first in the rail.
    await expect(page.getByTestId("project-avatar-0")).toBeVisible();
  });

  test("breadcrumb and theme toggle work", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("settings-tab-identity")).toBeVisible();
    const html = page.locator("html");
    const before = await html.getAttribute("class");
    // theme toggle is the lone icon button in the top bar header
    await page.locator("header button").last().click();
    await expect(html).not.toHaveClass(before ?? "");
  });
});
