import { test, expect, runtime } from "./fixtures";

// Walks every screen the panel exposes and asserts it renders without an
// uncaught exception. This is the read-only "does every screen work" sweep.

// Mirrors the nav order in SettingsScreen.tsx.
const SETTINGS_TABS = [
  "identity",
  "super_agent",
  "profile",
  "nudge",
  "engines",
  "memory",
  "skills",
  "telegram",
  "devices",
  "voice",
  "desktop",
  "deck",
  "web",
  "advanced",
] as const;

// key in the nav → active segment used by the project-tab testid.
const BASE_TABS: Array<[navKey: string, active: string]> = [
  ["workspaces", "workspaces"],
  ["models", "models"],
  ["agent-defaults", "agent-defaults"],
  ["index", "overview"],
  ["agents", "agents"],
  ["memories", "memories"],
  ["skills", "skills"],
  ["artifacts", "artifacts"],
  ["chat", "chat"],
  ["sessions", "sessions"],
  ["logs", "logs"],
  ["routines", "routines"],
  ["tasks", "tasks"],
  ["commitments", "commitments"],
  ["mcps", "mcps"],
  ["integrations", "integrations"],
  ["vars", "vars"],
  ["config", "config"],
];

// Telegram is gone from the project nav — it lives under Settings now, even
// though /p/:pid/telegram still resolves. "structure" is company-only, and the
// throwaway project the fixtures register is not a company, so it is absent.
const PROJECT_TABS: Array<[navKey: string, active: string]> = [
  ["index", "overview"],
  ["agents", "agents"],
  ["memories", "memories"],
  ["skills", "skills"],
  ["artifacts", "artifacts"],
  ["chat", "chat"],
  ["sessions", "sessions"],
  ["logs", "logs"],
  ["docs", "docs"],
  ["files", "files"],
  ["routines", "routines"],
  ["tasks", "tasks"],
  ["commitments", "commitments"],
  ["mcps", "mcps"],
  ["integrations", "integrations"],
  ["vars", "vars"],
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

  test("super-agent settings offers the shared blob catalog", async ({ page, errors }) => {
    await page.goto("/settings/super-agent");
    const picker = page.getByTestId("agent-icon-picker");
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button")).toHaveCount(35);
    expect(errors).toEqual([]);
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
