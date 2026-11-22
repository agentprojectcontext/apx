// An answer shows as the model writes it: the chat holds part of it before the whole has come.
import { randomUUID } from "node:crypto";
import { expect, open, test, world } from "./kit.ts";

test("an agent's answer grows in the chat while it is written", async ({ page }) => {
  await open(page);
  const prompt = `Write slowly about the plan ${randomUUID()}`;
  await world.streamGate(prompt, "hold");
  try {
    const box = page.getByRole("textbox", { name: /^Escribile a/ });
    await box.fill(prompt);
    await box.press("Enter");
    const answer = page.locator(".transcript").getByText(`Got it: ${prompt}`);
    await expect(answer).toBeVisible();
    expect(await answer.textContent()).not.toContain("Done.");
    await world.streamGate(prompt, "next");
    await expect(answer).toContainText("Done.");
  } finally {
    await world.streamGate(prompt, "clear");
  }
});
