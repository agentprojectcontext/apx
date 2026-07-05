import { test, expect, runtime } from "./fixtures";

// Walks every screen the panel exposes and asserts it renders without an
// uncaught exception. This is the read-only "does every screen work" sweep.

const SETTINGS_TABS = [
  "identity",
  "appearance",
  "super_agent",
  "engines",
  "telegram",
  "devices",
  "voice",
  "deck",
  "desktop",
  "advanced",
] as const;

// key in the nav → active segment used by the project-tab testid.
const BASE_TABS: Array<[navKey: string, active: string]> = [
  ["index", "overview"],
  ["workspaces", "workspaces"],
  ["models", "models"],
  ["agent-defaults", "agent-defaults"],
  ["chat", "chat"],
  ["sessions", "sessions"],
  ["tasks", "tasks"],
  ["logs", "logs"],
  ["agents", "agents"],
  ["memories", "memories"],
  ["routines", "routines"],
  ["mcps", "mcps"],
  ["config", "config"],
];

const PROJECT_TABS: Array<[navKey: string, active: string]> = [
  ["index", "overview"],
  ["telegram", "telegram"],
  ["chat", "chat"],
  ["agents", "agents"],
  ["docs", "docs"],
  ["files", "files"],
  ["memories", "memories"],
  ["routines", "routines"],
  ["tasks", "tasks"],
  ["mcps", "mcps"],
  ["logs", "logs"],
  ["config", "config"],
];

test.describe("navigation smoke", () => {
  test("every settings panel renders", async ({ page, errors }) => {
    await page.goto("/settings");
    for (const tab of SETTINGS_TABS) {
      await page.getByTestId(`tabnav-${tab}`).click();
      await expect(
        page.getByTestId(`settings-tab-${tab}`),
        `settings panel "${tab}" should render`,
      ).toBeVisible();
    }
    expect(errors, "no uncaught errors across settings panels").toEqual([]);
  });

  test("every Base (daemon) screen renders", async ({ page, errors }) => {
    await page.goto("/p/0");
    for (const [navKey, active] of BASE_TABS) {
      await page.getByTestId(`tabnav-${navKey}`).click();
      await expect(
        page.getByTestId(`project-tab-${active}`),
        `Base screen "${active}" should render`,
      ).toBeVisible();
    }
    expect(errors, "no uncaught errors across Base screens").toEqual([]);
  });

  test("every per-project screen renders", async ({ page, errors }) => {
    const { projectId } = runtime();
    await page.goto(`/p/${projectId}`);
    for (const [navKey, active] of PROJECT_TABS) {
      await page.getByTestId(`tabnav-${navKey}`).click();
      await expect(
        page.getByTestId(`project-tab-${active}`),
        `project screen "${active}" should render`,
      ).toBeVisible();
    }
    expect(errors, "no uncaught errors across project screens").toEqual([]);
  });
});
