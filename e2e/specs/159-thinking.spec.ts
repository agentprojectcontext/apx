// Thinking is visible while the model reasons, then disappears rather than becoming chat history.
import { expect, open, test, world } from "./kit.ts";

test("while the agent thinks the chat shows what about, and the answer replaces it", async ({ page }) => {
  await open(page);
  const prompt = "Think first about the launch";
  await world.streamGate(prompt, "hold");
  try {
    const box = page.getByRole("textbox", { name: /^Escribile a/ });
    await box.fill(prompt);
    await box.press("Enter");
    const thinking = page.locator(".transcript__thinking");
    await expect(page.locator(".transcript").getByText(/está pensando/)).toBeVisible();
    await expect(thinking).toHaveText("The owner wants a plan.");
    await world.streamGate(prompt, "next");
    await expect(thinking).toHaveText("Launch is close.");
    await world.streamGate(prompt, "next");
    await expect(page.locator(".transcript").getByText("Got it: Think first about the launch")).toBeVisible();
    await expect(thinking).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".transcript").getByText("Got it: Think first about the launch")).toBeVisible();
    await expect(page.locator(".transcript").getByText("Launch is close.")).toHaveCount(0);
  } finally {
    await world.streamGate(prompt, "clear");
  }
});
