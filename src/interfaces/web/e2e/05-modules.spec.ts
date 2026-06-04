import { test, expect } from "./fixtures";

// Rail-level modules (Voice / Deck / Code) — sit alongside Base. Validates the
// rail wiring + that each module screen renders against the real daemon with no
// uncaught error.

test.describe("rail modules", () => {
  test("Voices module renders with provider + test affordances", async ({ page, errors }) => {
    await page.goto("/");
    await page.getByTestId("module-avatar-voice").click();
    await expect(page).toHaveURL(/\/m\/voice/);
    await expect(page.getByTestId("screen-voice")).toBeVisible();
    await expect(page.getByTestId("voice-test-say")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Deck module renders the manifest", async ({ page, errors }) => {
    await page.goto("/");
    await page.getByTestId("module-avatar-deck").click();
    await expect(page).toHaveURL(/\/m\/deck/);
    await expect(page.getByTestId("screen-deck")).toBeVisible();
    // daemon card renders once /deck/manifest resolves
    await expect(page.getByTestId("deck-daemon-card")).toBeVisible();
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
});
