import { test, expect, runtime } from "./fixtures";

// Mutating flows — scoped entirely to the throwaway project created in
// global-setup, which global-teardown unregisters and deletes. The user's real
// projects are never touched.

test.describe("isolated CRUD", () => {
  test("task lifecycle: add → done → reopen → drop", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e task ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);

    // add — the title lives in the task dialog now (same form used to edit),
    // so open it first. Wait until the controlled input actually holds the
    // value (React state synced) before submitting.
    await page.getByTestId("task-new").click();
    const input = page.getByTestId("task-input");
    await input.click();
    await input.fill(title);
    await expect(input).toHaveValue(title);
    await page.getByTestId("task-add").click();
    const list = page.getByTestId("task-list");
    const row = list.locator("li", { hasText: title });
    await expect(row).toBeVisible();

    // Lifecycle verbs live behind the row's ⋯ menu; the items are portaled, so
    // they are located on the page, not inside the row. Only `drop` still
    // confirms — finishing a task is one click now (the square on the row is a
    // checkbox, and undo rides the toast), so a done-confirm no longer exists.
    const rowAction = async (row: ReturnType<typeof list.locator>, action: string) => {
      await row.locator('[data-testid^="task-menu-"]').click();
      await page.locator(`[data-testid^="task-${action}-"]`).click();
      if (action === "drop") {
        await page.getByTestId("task-row-drop-confirm").click();
      }
    };

    // done → leaves the open list, shows under "done"
    await rowAction(row, "done");
    await expect(list.locator("li", { hasText: title })).toHaveCount(0);
    await page.getByTestId("task-filter-done").click();
    const doneRow = page.getByTestId("task-list").locator("li", { hasText: title });
    await expect(doneRow).toBeVisible();

    // reopen → back under "open". The filter is asked for EXPLICITLY: it is
    // remembered per device now (taskViewPrefs.ts), so a reload no longer
    // quietly resets it to "open" the way this step used to rely on.
    await rowAction(doneRow, "reopen");
    await page.reload();
    await page.getByTestId("task-filter-open").click();
    const reopened = page.getByTestId("task-list").locator("li", { hasText: title });
    await expect(reopened).toBeVisible();

    // drop → shows under "dropped"
    await rowAction(reopened, "drop");
    await page.reload();
    await page.getByTestId("task-filter-dropped").click();
    await expect(
      page.getByTestId("task-list").locator("li", { hasText: title }),
    ).toBeVisible();
  });

  test("agent create: new agent appears in the project", async ({ page }) => {
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}/agents`);

    await page.getByTestId("agent-new").click();
    await page.getByTestId("agent-slug").fill("e2ebot");
    await page.getByTestId("agent-create-submit").click();

    await expect(page.getByTestId("agent-card-e2ebot")).toBeVisible();
  });
});
