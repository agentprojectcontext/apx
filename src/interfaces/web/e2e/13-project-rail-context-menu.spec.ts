import { test, expect } from "./fixtures";

// The rail draws one 40px tile per project and has nowhere to hang a "⋯", so
// the verbs that don't fit live in a right-click menu on the tile. Unregister
// never fires from the menu itself: it arms a dialog, and only the dialog
// deletes. GET /api/projects is mocked (and DELETE intercepted) so the spec
// never touches the user's real registry.
const BASE = { id: 0, path: "/tmp/base", name: "Base", kind: "default" };
const UNO = { id: 41, path: "/tmp/proj-uno", name: "Uno", kind: "software" };
const DOS = { id: 42, path: "/tmp/proj-dos", name: "Dos", kind: "software" };

test.describe("project rail context menu", () => {
  let deleted: string[] = [];

  test.beforeEach(async ({ page }) => {
    let registry = [BASE, UNO, DOS];
    deleted = [];

    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(registry),
      });
    });
    // Only DELETE is answered here; every other per-project call (config,
    // integrations…) goes through to the daemon untouched.
    await page.route("**/api/projects/*", async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      const id = new URL(route.request().url()).pathname.split("/").pop() as string;
      deleted.push(id);
      registry = registry.filter((p) => String(p.id) !== id);
      await route.fulfill({ status: 204, body: "" });
    });
    // Tall enough that both projects sit inline on the rail instead of
    // collapsing into the "+N" bucket, which has no context menu.
    await page.setViewportSize({ width: 1200, height: 1000 });
  });

  test("unregister asks first, then drops the project from the rail", async ({ page, errors }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-avatar-42")).toBeVisible();

    await page.getByTestId("project-avatar-42").click({ button: "right" });
    await expect(page.getByTestId("project-ctx-42")).toBeVisible();

    await page.getByTestId("project-ctx-unregister-42").click();
    // Picking the menu item deletes nothing on its own.
    expect(deleted).toEqual([]);

    const confirm = page.getByTestId("project-unregister-confirm");
    await expect(confirm).toBeVisible();
    await confirm.click();

    await expect(page.getByTestId("project-avatar-42")).toHaveCount(0);
    expect(deleted).toEqual(["42"]);
    // The rest of the rail is untouched.
    await expect(page.getByTestId("project-avatar-41")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("dismissing the dialog leaves the project registered", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("project-avatar-42").click({ button: "right" });
    await page.getByTestId("project-ctx-unregister-42").click();
    await expect(page.getByTestId("project-unregister-confirm")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("project-unregister-confirm")).toHaveCount(0);
    await expect(page.getByTestId("project-avatar-42")).toBeVisible();
    expect(deleted).toEqual([]);
  });

  test("the menu opens the project's config", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("project-avatar-41").click({ button: "right" });
    await page.getByTestId("project-ctx-config-41").click();

    await expect(page).toHaveURL(/\/p\/41\/config$/);
  });
});
