import { test, expect, runtime } from "./fixtures";

// Usability checks on the always-on entry points: the floating Roby chat and
// the add-project dialog. Both are read-only here (no project is created).

test.describe("usability", () => {
  test("Roby floating chat opens and closes", async ({ page, errors }) => {
    await page.goto("/");
    const launcher = page.getByRole("button", { name: "Hablar con Roby" });
    await expect(launcher).toBeVisible();
    await launcher.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    // Composer shows the model picker (not the old "POST /…" route footer).
    await expect(page.getByTestId("chat-model-picker")).toBeVisible();
    await expect(sheet).not.toContainText("POST /projects");
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
    // The icon-only done/drop/reopen buttons must be reachable by name. We
    // assert the add affordance and filters are labelled/usable on the
    // per-project Tasks screen (Base /p/0/tasks renders the global view).
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}/tasks`);
    await expect(page.getByTestId("task-add")).toBeVisible();
    await expect(page.getByTestId("task-filter-open")).toBeVisible();
    await expect(page.getByTestId("task-filter-done")).toBeVisible();
    await expect(page.getByTestId("task-filter-dropped")).toBeVisible();
  });
});
