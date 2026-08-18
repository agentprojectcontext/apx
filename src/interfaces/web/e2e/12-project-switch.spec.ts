import { test, expect, runtime } from "./fixtures";

// Switching projects from the rail changes only the project: the tab you were
// reading stays open on the other side. Tabs that exist on one side only (Base
// admin vs project content) fall back to the target's overview.
test.describe("project switch keeps the tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 1000 });
  });

  test("a shared tab travels across the switch", async ({ page }) => {
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}/agents`);
    await expect(page.getByTestId("project-tab-agents")).toBeVisible();

    await page.getByTestId("project-avatar-0").click();

    await expect(page).toHaveURL(/\/p\/0\/agents$/);
    await expect(page.getByTestId("project-tab-agents")).toBeVisible();
  });

  test("a row id does not travel — only the section does", async ({ page }) => {
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}/agents/nonexistent-agent`);

    await page.getByTestId("project-avatar-0").click();

    await expect(page).toHaveURL(/\/p\/0\/agents$/);
  });

  test("a project-only tab falls back to the Base overview", async ({ page }) => {
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}/docs`);

    await page.getByTestId("project-avatar-0").click();

    await expect(page).toHaveURL(/\/p\/0$/);
  });

  test("a Base-only tab falls back to the project overview", async ({ page }) => {
    const { projectId } = runtime();
    await page.goto("/p/0/models");

    await page.getByTestId(`project-avatar-${projectId}`).click();

    await expect(page).toHaveURL(new RegExp(`/p/${projectId}$`));
  });
});
