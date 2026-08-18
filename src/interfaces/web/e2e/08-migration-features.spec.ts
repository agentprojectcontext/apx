import { test, expect, runtime } from "./fixtures";

// Coverage for the PandaProject-migrated surfaces: docs editor, org structure,
// richer task detail, and the agent avatar/autonomy fields. All scoped to the
// throwaway project from global-setup (deleted in teardown).

test.describe("migrated features", () => {
  test("docs: create a document and see it in the tree", async ({ page, errors }) => {
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}/docs`);

    const name = `spec-${Date.now()}.md`;
    await page.getByTestId("docs-new").click();
    const pathInput = page.getByTestId("new-file-path");
    await pathInput.fill(name);
    await expect(pathInput).toHaveValue(name);
    await page.getByTestId("new-file-create").click();

    // The new file becomes selected → the viewer header shows its path.
    await expect(page.getByTestId("file-viewer")).toContainText(name);
    expect(errors, "docs screen has no uncaught errors").toEqual([]);
  });

  test("structure: create an area", async ({ page, errors }) => {
    const { projectId } = runtime();
    // Route works regardless of the nav gating (which only hides the tab for
    // non-company projects).
    await page.goto(`/p/${projectId}/structure`);

    const areaName = `Area ${Date.now()}`;
    await page.getByTestId("structure-new-area").click();
    await page.getByTestId("area-name").fill(areaName);
    await page.getByTestId("area-create").click();

    await expect(page.getByText(areaName)).toBeVisible();
    expect(errors, "structure screen has no uncaught errors").toEqual([]);
  });

  test("files: read-only project browser renders", async ({ page, errors }) => {
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}/files`);
    // The tree sidebar + viewer prompt render even before a file is picked.
    await expect(page.getByTestId("file-viewer")).toBeVisible();
    expect(errors, "files screen has no uncaught errors").toEqual([]);
  });

  test("task detail panel: add a task then open its detail", async ({ page }) => {
    const { projectId } = runtime();
    const title = `detail task ${Date.now()}`;
    await page.goto(`/p/${projectId}/tasks`);

    await page.getByTestId("task-new").click();
    const input = page.getByTestId("task-input");
    await input.fill(title);
    await expect(input).toHaveValue(title);
    await page.getByTestId("task-add").click();

    const row = page.getByTestId("task-list").locator("li", { hasText: title });
    await expect(row).toBeVisible();
    await row.click();

    // Detail panel opens with the task title + prompt field.
    const panel = page.getByTestId("task-detail");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(title);
  });

  test("agent editor exposes the avatar picker + autonomy control", async ({ page }) => {
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}/agents`);
    await page.getByTestId("agent-new").click();
    // The create dialog carries the blob avatar picker and the autonomy
    // segmented control alongside the slug. Emoji avatars were dropped (see
    // components/agents/AgentFormFields.tsx) — one visual language, not two.
    // Located by testid: the field labels are translated and the blob names
    // are a catalogue that churns.
    await expect(page.getByTestId("agent-slug")).toBeVisible();
    const avatars = page.getByTestId("agent-icon-picker");
    await expect(avatars).toBeVisible();
    expect(await avatars.getByRole("button").count()).toBeGreaterThan(1);
    // Three modes: total / auto / permission.
    await expect(page.getByTestId("agent-autonomy").getByRole("button")).toHaveCount(3);
  });
});
