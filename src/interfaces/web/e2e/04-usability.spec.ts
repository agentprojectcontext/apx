import { test, expect, runtime } from "./fixtures";

// Usability checks on the always-on entry points: the floating Roby chat and
// the add-project dialog. Both are read-only here (no project is created).

test.describe("usability", () => {
  test("Roby floating chat opens and closes", async ({ page, errors }) => {
    await page.goto("/");
    // The launcher lives in the left rail, and its accessible name is the
    // persona from identity.json in the active locale — so it is located by
    // testid, not by a hardcoded "Hablar con Roby".
    const launcher = page.getByTestId("nav-roby");
    await expect(launcher).toBeVisible();
    await launcher.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    // Composer shows the model picker (not the old "POST /…" route footer).
    await expect(page.getByTestId("chat-model-picker")).toBeVisible();
    await expect(sheet).not.toContainText("POST /api/projects");
    // Escape is the robust dismiss (the sheet has an overlaying close button).
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("add-project dialog opens and dismisses without mutating", async ({ page }) => {
    await page.goto("/?action=add-project");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // back on the admin screen, nothing registered
    await expect(page.getByTestId("screen-admin")).toBeVisible();
  });

  test("task action buttons expose accessible names (a11y)", async ({ page }) => {
    // The icon-only add/menu affordances must be reachable by name. Same
    // screen serves both scopes now (Base /p/0/tasks passes no project).
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}/tasks`);
    await expect(page.getByTestId("task-new")).toBeVisible();
    await expect(page.getByTestId("task-filter-open")).toBeVisible();
    await expect(page.getByTestId("task-filter-done")).toBeVisible();
    await expect(page.getByTestId("task-filter-dropped")).toBeVisible();
  });
});
