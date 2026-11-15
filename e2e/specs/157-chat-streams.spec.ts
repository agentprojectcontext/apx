// An answer shows as the model writes it: the chat holds part of it before the whole has come.
import { expect, open, test } from "./kit.ts";

test("an agent's answer grows in the chat while it is written", async ({ page }) => {
  await open(page);
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("Write slowly about the plan");
  await box.press("Enter");
  const answer = page.locator(".transcript").getByText(/^Got it: Write slowly about the plan/);
  await expect(answer).toBeVisible();
  // Seen before the last piece has come: part of the answer, not all of it.
  expect(await answer.textContent()).not.toContain("Done.");
  await expect(answer).toContainText("Done.");
});
