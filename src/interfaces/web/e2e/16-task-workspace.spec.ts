import { test, expect, runtime } from "./fixtures";

// The task workspace: one-click completion, description vs agent prompt,
// tags, subtasks, comments, and the board with its configurable columns.
//
// Everything runs against the throwaway project global-setup creates, so the
// user's real tasks are never touched. Nothing here summons an agent: a comment
// only starts a turn when it @-mentions one, and none of these do.

/**
 * Type into a controlled input and wait until React has the value.
 *
 * `fill()` alone races the button it gates: the DOM value is set, the state
 * update has not landed, and the click hits a still-disabled button. This is
 * the same wait 03-crud-isolated.spec.ts does for the task title.
 */
async function typeInto(field: import("@playwright/test").Locator, value: string) {
  await field.click();
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

/** Create a task through the dialog and return its title. */
async function addTask(page: import("@playwright/test").Page, title: string) {
  await page.getByTestId("task-new").click();
  await typeInto(page.getByTestId("task-input"), title);
  await page.getByTestId("task-add").click();
  await expect(page.getByTestId("task-list").locator("li", { hasText: title })).toBeVisible();
}

test.describe("task workspace", () => {
  test("the row's status square completes in one click, and undo puts it back", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e tick ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);
    await addTask(page, title);

    const list = page.getByTestId("task-list");
    const row = list.locator("li", { hasText: title });
    // No menu, no dialog: the square IS the checkbox.
    await row.locator('[data-testid^="task-tick-"]').click();
    await expect(list.locator("li", { hasText: title })).toHaveCount(0);

    // Undo lives on the toast, which is what replaced the confirm dialog.
    await page.getByTestId("toast-action").click();
    await expect(page.getByTestId("task-list").locator("li", { hasText: title })).toBeVisible();
  });

  test("description and agent prompt are separate fields", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e fields ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);

    await page.getByTestId("task-new").click();
    await typeInto(page.getByTestId("task-input"), title);
    await typeInto(page.getByTestId("task-description"), "lo que tengo que hacer yo");
    await page.getByTestId("task-add").click();

    await page.getByTestId("task-list").locator("li", { hasText: title }).click();
    const detail = page.getByTestId("task-detail");
    await expect(detail).toContainText("lo que tengo que hacer yo");
    // The prompt block renders only when there IS a prompt — an empty one on
    // top of a plain to-do is exactly what made the list unreadable.
    await expect(detail).not.toContainText("Agent prompt");
  });

  test("tags can be added from the form and render as chips", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e tags ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);

    await page.getByTestId("task-new").click();
    await typeInto(page.getByTestId("task-input"), title);
    const tags = page.getByTestId("task-tags-input");
    await typeInto(tags, "urgente");
    await tags.press("Enter");
    // The second one is left as a DRAFT on purpose: saving must commit it too,
    // which is most of why tags never got filled in before.
    await typeInto(tags, "cliente");
    await page.getByTestId("task-add").click();

    await page.getByTestId("task-list").locator("li", { hasText: title }).click();
    await expect(page.getByTestId("task-tag-urgente")).toBeVisible();
    await expect(page.getByTestId("task-tag-cliente")).toBeVisible();
  });

  test("a subtask is a real task, and closing it moves the parent's counter", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e epic ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);
    await addTask(page, title);
    await page.getByTestId("task-list").locator("li", { hasText: title }).click();
    await expect(page.getByTestId("task-detail")).toContainText(title);

    await typeInto(page.getByTestId("subtask-input"), "primera parte");
    await page.getByTestId("subtask-add").click();
    const kids = page.getByTestId("task-subtasks");
    await expect(kids.locator("li", { hasText: "primera parte" })).toBeVisible();

    // Ticking a child off is the same verb the list uses.
    await kids.locator('[data-testid^="subtask-tick-"]').first().click();
    await expect(page.getByTestId("task-detail")).toContainText("(1/1)");
  });

  test("a comment lands in the thread and summons nobody when it names nobody", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e comment ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);
    await addTask(page, title);
    await page.getByTestId("task-list").locator("li", { hasText: title }).click();
    await expect(page.getByTestId("task-detail")).toContainText(title);

    await typeInto(page.getByTestId("task-comment-input"), "una nota sin menciones");
    await page.getByTestId("task-comment-send").click();
    await expect(page.getByTestId("task-comments")).toContainText("una nota sin menciones");

    // It survives a reload — the thread is on the event log, not in React state.
    await page.reload();
    await expect(page.getByTestId("task-comments")).toContainText("una nota sin menciones");
  });

  test("the board renders the configured columns and the list still works", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e board ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);
    await addTask(page, title);

    await page.getByTestId("task-view-board").click();
    await expect(page.getByTestId("task-board")).toBeVisible();
    // The four shipped columns plus the terminal one nothing can remove.
    await expect(page.getByTestId("board-col-pending")).toBeVisible();
    await expect(page.getByTestId("board-col-done")).toBeVisible();
    await expect(page.locator(`[data-testid^="board-card-"]`, { hasText: title })).toBeVisible();

    // The board is a view, not a replacement: the list is exactly as it was.
    await page.getByTestId("task-view-list").click();
    await expect(page.getByTestId("task-list").locator("li", { hasText: title })).toBeVisible();
  });

  test("a column added to the catalog shows up on the board", async ({ page }) => {
    const { projectId } = runtime();
    const name = `QA${Date.now() % 100000}`;
    await page.goto(`/p/${projectId}/tasks?view=board`);
    await expect(page.getByTestId("task-board")).toBeVisible();

    await page.getByTestId("task-columns").click();
    await typeInto(page.getByTestId("column-new"), name);
    await page.getByTestId("column-add").click();
    await page.getByTestId("columns-save").click();

    const id = name.toLowerCase();
    await expect(page.getByTestId(`board-col-${id}`)).toBeVisible();

    // Put it back, so a re-run starts from the same catalog it did the first time.
    await page.getByTestId("task-columns").click();
    await page.getByTestId(`column-remove-${id}`).click();
    await page.getByTestId("columns-save").click();
    await expect(page.getByTestId(`board-col-${id}`)).toHaveCount(0);
  });
});
