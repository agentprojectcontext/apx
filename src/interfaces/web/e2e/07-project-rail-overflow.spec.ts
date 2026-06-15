import { test, expect } from "./fixtures";

// The rail must never overflow the viewport: projects beyond what fits collapse
// into a "+N" popover, and the whole section can be folded into one folder.
// We mock GET /projects so the test is deterministic regardless of what the
// user actually has registered.
const BASE = { id: 0, path: "/tmp/base", name: "Base", kind: "default" };
const MANY = Array.from({ length: 16 }, (_, i) => ({
  id: i + 1,
  path: `/tmp/proj-${i + 1}`,
  name: `Project ${i + 1}`,
  kind: "software",
}));
const PROJECTS = [BASE, ...MANY];

test.describe("project rail overflow", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/projects", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PROJECTS),
      });
    });
    await page.setViewportSize({ width: 1200, height: 1000 });
  });

  test("extra projects fall into a +N popover, newest stay inline", async ({ page, errors }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();

    // Newest-first: the highest id (16) is the first project shown inline.
    await expect(page.getByTestId("project-avatar-16")).toBeVisible();

    // Not all 16 fit at this height → an overflow bucket appears.
    const overflow = page.getByTestId("nav-projects-overflow");
    await expect(overflow).toBeVisible();

    // The oldest project (id 1) is NOT inline...
    await expect(page.getByTestId("project-avatar-1")).toHaveCount(0);
    // ...but is reachable from the popover.
    await overflow.click();
    await expect(page.getByTestId("project-menu-item-1")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("collapse folds every project into one folder button", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("nav-toggle-projects")).toBeVisible();

    await page.getByTestId("nav-toggle-projects").click();

    const folder = page.getByTestId("nav-projects-folder");
    await expect(folder).toBeVisible();
    // No inline project avatars while collapsed.
    await expect(page.getByTestId("project-avatar-16")).toHaveCount(0);

    // The folder lists every project (newest included).
    await folder.click();
    await expect(page.getByTestId("project-menu-item-16")).toBeVisible();
    await expect(page.getByTestId("project-menu-item-1")).toBeVisible();
  });
});
