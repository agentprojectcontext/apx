import { test, expect, runtime } from "./fixtures";

// The task workspace: one-click completion, description vs agent prompt,
// tags, subtasks, comments, and the board with its configurable columns.
//
// Tasks run against the throwaway project global-setup creates, so the user's
// real tasks are never touched. Nothing here summons an agent: a comment only
// starts a turn when it @-mentions one, and none of these do.
//
// COLUMNS ARE THE EXCEPTION AND NEED THEIR OWN CLEANUP. The catalog is GLOBAL by
// design — one vocabulary for every project — so there is no throwaway copy of
// it to work in. A test that adds a column and then fails before its own
// teardown leaves that column in the real config, which is exactly what happened
// while this file was being written. The afterEach below restores the shipped
// four whatever the test did.

/** The catalog every run must start and end with. */
const DEFAULT_COLUMNS = ["pending", "running", "in_review", "blocked"];

async function restoreColumns() {
  const { daemon, token } = runtime();
  await fetch(`${daemon}/api/tasks/columns`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ columns: DEFAULT_COLUMNS.map((id) => ({ id })) }),
  });
}

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
  test.afterEach(restoreColumns);

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

  test("who has a task is a visible, in-place field — even when nobody does", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e assignee ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);
    await addTask(page, title);
    await page.getByTestId("task-list").locator("li", { hasText: title }).click();
    await expect(page.getByTestId("task-detail")).toContainText(title);

    // It used to be a bare "@slug" buried in the meta strip, and nothing at all
    // when empty — so an unassigned task looked like one that could not be
    // assigned. The empty picker is what asks the question.
    const picker = page.getByTestId("task-agent-select");
    await expect(picker).toBeVisible();
    await expect(picker).toContainText("—");
  });

  test("the state filter actually filters the board", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e filter ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);
    await addTask(page, title);

    await page.getByTestId("task-view-board").click();
    const card = page.locator(`[data-testid^="board-card-"]`, { hasText: title });
    await expect(card).toBeVisible();

    // The chips were on screen and inert: the board fetched everything and
    // ignored them. An open task must not show up under "Done".
    await page.getByTestId("task-filter-done").click();
    await expect(card).toHaveCount(0);

    await page.getByTestId("task-filter-open").click();
    await expect(card).toBeVisible();
  });

  test("a custom column renders everywhere, board and list", async ({ page }) => {
    const { projectId } = runtime();
    const name = `Rev${Date.now() % 100000}`;
    const id = name.toLowerCase();
    const title = `e2e custom ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);
    await addTask(page, title);

    // Add the column…
    await page.getByTestId("task-view-board").click();
    await page.getByTestId("task-columns").click();
    await typeInto(page.getByTestId("column-new"), name);
    await page.getByTestId("column-add").click();
    await page.getByTestId("columns-save").click();
    await expect(page.getByTestId(`board-col-${id}`)).toBeVisible();

    // …and move a task into it from the DETAIL, whose dropdown used to know
    // only the four built-ins — you could drag a card somewhere the rest of
    // the UI could not name.
    await page.locator(`[data-testid^="board-card-"]`, { hasText: title }).click();
    await page.getByTestId("task-status-select").click();
    await page.getByRole("option", { name }).click();
    await expect(page.getByTestId(`board-col-${id}`).locator("article", { hasText: title })).toBeVisible();

    // The list is the case that used to CRASH: every status helper indexed a
    // four-entry table directly, so the first custom column took it down.
    await page.getByTestId("task-view-list").click();
    const row = page.getByTestId("task-list").locator("li", { hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText(name);

    // Put the catalog back the way it was found.
    await page.getByTestId("task-view-board").click();
    await page.getByTestId("task-columns").click();
    await page.getByTestId(`column-remove-${id}`).click();
    await page.getByTestId("columns-save").click();
    await expect(page.getByTestId(`board-col-${id}`)).toHaveCount(0);
  });

  test("an errand can be created with its place — the form's whole point for mobility", async ({ page }) => {
    const { projectId } = runtime();
    const title = `e2e errand ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks?view=list`);

    // `trip` is the category the mobility geofence watches. It could not be
    // created from the panel at ALL — only from the CLI — so the errand
    // reminders had nothing to remind about.
    await page.getByTestId("task-new").click();
    await typeInto(page.getByTestId("task-input"), title);
    await page.getByTestId("task-category-select").click();
    await page.getByRole("option", { name: /Errand|Mandado/ }).click();

    await typeInto(page.getByTestId("task-place"), "Farmacia del Puente");
    await typeInto(page.getByTestId("task-address"), "Av. San Martín 1234, Bariloche");
    await typeInto(page.getByTestId("task-coords"), "-41.1335, -71.3103");
    await page.getByTestId("task-add").click();

    // The place survives the round trip and shows on the detail, where the
    // pinned version links out to Maps.
    await page.getByTestId("task-list").locator("li", { hasText: title }).click();
    const detail = page.getByTestId("task-detail");
    await expect(detail).toContainText("Farmacia del Puente");
    await expect(detail).toContainText("Av. San Martín 1234");

    // Re-opening the editor shows what was saved rather than an empty form.
    await page.getByTestId("task-detail-edit").click();
    await expect(page.getByTestId("task-place")).toHaveValue("Farmacia del Puente");
    await expect(page.getByTestId("task-coords")).toHaveValue("-41.1335, -71.3103");
  });

  test("the view and the filter you left on are the ones you come back to", async ({ page }) => {
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}/tasks`);
    await expect(page.getByTestId("task-list")).toBeVisible();

    // Leave it on the board, filtered to something other than the default.
    await page.getByTestId("task-view-board").click();
    await expect(page.getByTestId("task-board")).toBeVisible();
    await page.getByTestId("task-filter-all").click();

    // Go somewhere else entirely and come back with a bare URL — no ?view.
    // This is the trip that used to reset everything.
    await page.goto("/settings");
    await expect(page.getByTestId("settings-tab-identity")).toBeVisible();
    await page.goto(`/p/${projectId}/tasks`);

    await expect(page.getByTestId("task-board")).toBeVisible();
    await expect(page.getByTestId("task-filter-all")).toHaveAttribute("aria-pressed", "true");

    // A link that names a view still outranks the remembered one — otherwise a
    // URL someone sends opens whatever that device happened to be doing.
    await page.goto(`/p/${projectId}/tasks?view=list`);
    await expect(page.getByTestId("task-list")).toBeVisible();
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
