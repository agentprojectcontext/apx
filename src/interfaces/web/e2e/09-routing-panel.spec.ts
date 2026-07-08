import { test, expect } from "./fixtures";

// Content-based model routing (RouterLLM pattern) lives on the Models/Engines
// settings tab, right under the failover DefaultRouterCard. This validates the
// panel renders against the real daemon, shows its active/inactive signal, and
// that the enable toggle flips without blowing up the screen.

test.describe("content routing panel", () => {
  test("renders with an active/inactive signal and toggles enabled", async ({ page, errors }) => {
    await page.goto("/settings/engines");
    await expect(page).toHaveURL(/\/settings\/engines/);

    const panel = page.getByTestId("routing-panel");
    await expect(panel).toBeVisible();

    // The ON/OFF signal pill must be present — the user relies on it to know
    // routing is active.
    const signal = page.getByTestId("routing-signal");
    await expect(signal).toBeVisible();
    await expect(signal).toContainText(/Content routing:/i);

    // Flip the enable switch and confirm the signal reflects the new state.
    const before = (await signal.textContent()) || "";
    await panel.getByRole("switch").click();
    await expect(signal).not.toHaveText(before);

    expect(errors).toEqual([]);
  });
});
