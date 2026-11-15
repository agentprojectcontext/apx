// A model that thinks before it answers shows it: the chat says the agent is thinking and what about, live, and the
// thinking goes once the answer comes, never kept in the chat.
import { expect, open, test } from "./kit.ts";

test("while the agent thinks the chat shows what about, and the answer replaces it", async ({ page }) => {
  await open(page);
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("Think first about the launch");
  await box.press("Enter");
  const thinking = page.locator(".transcript__thinking");
  await expect(page.locator(".transcript").getByText(/está pensando/)).toBeVisible();
  await expect(thinking).toHaveText("The owner wants a plan.");
  await expect(thinking).toHaveText("Launch is close.");
  await expect(page.locator(".transcript").getByText("Got it: Think first about the launch")).toBeVisible();
  await expect(thinking).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".transcript").getByText("Got it: Think first about the launch")).toBeVisible();
  await expect(page.locator(".transcript").getByText("Launch is close.")).toHaveCount(0);
});
