import { test, expect } from "./fixtures";

// The inbox is a SECOND AXIS. The most important thing these specs protect is
// that adding it did not take anything away from project-first navigation —
// projects as a first-class unit is what APX has that a personal assistant
// does not.
test.describe("agent inbox", () => {
  test("is reachable from the rail and renders", async ({ page, errors }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-inbox")).toBeVisible();
    await page.getByTestId("nav-inbox").click();
    await expect(page).toHaveURL(/\/m\/inbox/);
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    expect(errors, "no uncaught page errors").toEqual([]);
  });

  test("survives a reload on its own URL (the SPA route is registered)", async ({ page, errors }) => {
    await page.goto("/m/inbox");
    await page.reload();
    await expect(page.getByTestId("inbox-list")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("project navigation still works and is not replaced", async ({ page }) => {
    await page.goto("/m/inbox");
    // The project rail is still there, and still goes where it always did.
    await expect(page.getByTestId("project-avatar-0")).toBeVisible();
    await page.getByTestId("project-avatar-0").click();
    await expect(page).toHaveURL(/\/p\/0/);
  });

  test("the home rail button still reaches the admin screen", async ({ page }) => {
    await page.goto("/m/inbox");
    await page.getByTestId("nav-home").click();
    await expect(page.getByTestId("screen-admin")).toBeVisible();
  });
});
