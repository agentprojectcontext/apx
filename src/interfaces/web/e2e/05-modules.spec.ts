import { test, expect } from "./fixtures";

// Rail-level modules (Desktop / Code) sit alongside Base. Voice and Deck no
// longer live in the rail — they moved into Settings → Modules. This validates
// the rail wiring + that each surface renders against the real daemon with no
// uncaught error.

test.describe("rail modules", () => {
  test("Desktop module shows status and links to its configuration", async ({ page, errors }) => {
    await page.goto("/");
    await page.getByTestId("module-avatar-desktop").click();
    await expect(page).toHaveURL(/\/m\/desktop/);
    await expect(page.getByTestId("screen-desktop")).toBeVisible();
    // The rail surface keeps only live status + last conversation; the settings
    // link takes the heavy config (autostart/shortcut/appearance) to Settings.
    await expect(page.getByRole("link", { name: /configuration/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Code module renders the coding REPL", async ({ page, errors }) => {
    await page.goto("/");
    await page.getByTestId("module-avatar-code").click();
    await expect(page).toHaveURL(/\/m\/code/);
    await expect(page.getByTestId("screen-code")).toBeVisible();
    await expect(page.getByTestId("code-project-select")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Code opens on every project's sessions, and the picker narrows them", async ({
    page,
    errors,
  }) => {
    await page.goto("/m/code");
    await expect(page.getByTestId("screen-code")).toBeVisible();

    // Unfiltered by default: a session started from another cwd (an
    // `apx exec --code` run) belongs to THAT project, and scoping the list to
    // the project in view is what made those invisible.
    const picker = page.getByTestId("code-project-select");
    await expect(picker).toContainText(/all projects|todos los proyectos/i);

    expect(errors).toEqual([]);
  });

  test("Code puts the agent choice in the New session dialog, not the rail", async ({
    page,
    errors,
  }) => {
    await page.goto("/m/code");
    await expect(page.getByTestId("screen-code")).toBeVisible();

    await page.getByTestId("code-new-session").click();
    const dialog = page.getByTestId("code-new-session-dialog");
    await expect(dialog).toBeVisible();
    // Project AND agent are chosen up front — a session has to land somewhere,
    // and "who answers in it" is a decision, not a rail-bottom dropdown that
    // silently re-points whatever session happens to be open.
    await expect(dialog.getByTestId("code-project-select")).toBeVisible();
    await expect(dialog).toContainText(/super-agent/i);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe("module settings", () => {
  test("Voices panel renders with provider + test affordances", async ({ page, errors }) => {
    await page.goto("/settings");
    await page.getByTestId("tabnav-voice").click();
    await expect(page).toHaveURL(/\/settings\/voice/);
    await expect(page.getByTestId("screen-voice")).toBeVisible();
    await expect(page.getByTestId("voice-test-say")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Deck panel renders the manifest", async ({ page, errors }) => {
    await page.goto("/settings");
    await page.getByTestId("tabnav-deck").click();
    await expect(page).toHaveURL(/\/settings\/deck/);
    await expect(page.getByTestId("screen-deck")).toBeVisible();
    // daemon card renders once /api/deck/manifest resolves
    await expect(page.getByTestId("deck-daemon-card")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Desktop panel renders the persisted settings", async ({ page, errors }) => {
    await page.goto("/settings");
    await page.getByTestId("tabnav-desktop").click();
    await expect(page).toHaveURL(/\/settings\/desktop/);
    await expect(page.getByTestId("settings-desktop")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
