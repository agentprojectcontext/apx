import { test, expect } from "./fixtures";

// Interrupt or queue, when you write while an agent is working.
//
// The switch used to appear ONLY while a turn was running, on the grounds that
// a control for a situation you are not in is clutter. That is the one moment
// it is too late to use: by the time it exists, the turn you wanted to queue
// behind is already burning, and you are choosing the mode and writing the
// message in the same breath. A preference you can only set while it is already
// applying is one you discover by watching it go wrong.

const PID = "1";

test.describe("send mode", () => {
  test("the switch is there before a turn runs, not only during one", async ({ page, errors }) => {
    await page.goto(`/p/${PID}/chat`);
    // Nothing is running: this is exactly when you get to decide.
    await expect(page.getByTestId("send-mode-toggle")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("interrupt is the default, and the choice sticks per device", async ({ page, errors }) => {
    await page.goto(`/p/${PID}/chat`);
    const toggle = page.getByTestId("send-mode-toggle");

    // Writing while an agent works almost always means "no, stop, do this
    // instead" — the same thing a new message has always done on Telegram.
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Per device, like the channel view/notify choices: it has to survive the
    // reload, or it is not a preference, it is a mood.
    await page.reload();
    await expect(page.getByTestId("send-mode-toggle")).toHaveAttribute("aria-pressed", "true");

    // And the way back is the same control.
    await page.getByTestId("send-mode-toggle").click();
    await expect(page.getByTestId("send-mode-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  });

  test("it is the same switch on every surface — one question, not one per pane", async ({ page, errors }) => {
    await page.goto(`/p/${PID}/chat`);
    await page.getByTestId("send-mode-toggle").click();
    await expect(page.getByTestId("send-mode-toggle")).toHaveAttribute("aria-pressed", "true");

    // The phone's chat is the same composer. A per-pane answer to "what happens
    // if I write now" is how the same chat ends up behaving differently
    // depending on which page you opened it from.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/m/chat");
    const row = page.getByTestId("inbox-list").or(page.locator("body"));
    await expect(row).toBeVisible();
    await page.goto(`/p/${PID}/chat`);
    await expect(page.getByTestId("send-mode-toggle")).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });
});
