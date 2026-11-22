// The model waits for the test's acknowledgement, so partial output cannot finish before it is observed.
import { expect, open, test } from "./kit.ts";
import { holdStream } from "./stream-control.test-support.ts";

test("an agent's answer grows in the chat while it is written", async ({ page }) => {
  await open(page);
  const stream = await holdStream("Write slowly about the plan");
  try {
    const box = page.getByRole("textbox", { name: /^Escribile a/ });
    await box.fill("Write slowly about the plan");
    await box.press("Enter");
    const answer = page.locator(".transcript").getByText(/^Got it: Write slowly about the plan/);
    await expect(answer).toBeVisible();
    expect(await answer.textContent()).not.toContain("Done.");
    await stream.next();
    await expect(answer).toContainText("Done.");
  } finally {
    await stream.release();
  }
});
