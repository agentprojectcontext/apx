import { test, expect, runtime } from "./fixtures";

// Mutating flows — scoped entirely to the throwaway project created in
// global-setup, which global-teardown unregisters and deletes. The user's real
// projects are never touched.

test.describe("isolated CRUD", () => {
  test("task lifecycle: add → done → reopen → drop", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e task ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);

    // add
    await page.getByTestId("task-input").fill(title);
    await page.getByTestId("task-add").click();
    const list = page.getByTestId("task-list");
    const row = list.locator("li", { hasText: title });
    await expect(row).toBeVisible();

    // done → leaves the open list, shows under "done"
    await row.getByLabel("marcar done").click();
    await expect(list.locator("li", { hasText: title })).toHaveCount(0);
    await page.getByTestId("task-filter-done").click();
    const doneRow = page.getByTestId("task-list").locator("li", { hasText: title });
    await expect(doneRow).toBeVisible();

    // reopen → back under "open"
    await doneRow.getByLabel("reabrir task").click();
    await page.getByTestId("task-filter-open").click();
    const reopened = page.getByTestId("task-list").locator("li", { hasText: title });
    await expect(reopened).toBeVisible();

    // drop → shows under "dropped"
    await reopened.getByLabel("descartar task").click();
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
