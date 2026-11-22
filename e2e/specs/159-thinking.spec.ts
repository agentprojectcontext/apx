// Each thinking phase stays visible until observed, then the answer replaces it and survives reload.
import { expect, open, test } from "./kit.ts";
import { holdStream } from "./stream-control.test-support.ts";

test("while the agent thinks the chat shows what about, and the answer replaces it", async ({ page }) => {
  await open(page);
  const stream = await holdStream("Think first about the launch");
  try {
    const box = page.getByRole("textbox", { name: /^Escribile a/ });
    await box.fill("Think first about the launch");
    await box.press("Enter");
    const thinking = page.locator(".transcript__thinking");
    await expect(page.locator(".transcript").getByText(/está pensando/)).toBeVisible();
    await expect(thinking).toHaveText("The owner wants a plan.");
    await stream.next();
    await expect(thinking).toHaveText("Launch is close.");
    await stream.next();
    await expect(page.locator(".transcript").getByText("Got it: Think first about the launch")).toBeVisible();
    await expect(thinking).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".transcript").getByText("Got it: Think first about the launch")).toBeVisible();
    await expect(page.locator(".transcript").getByText("Launch is close.")).toHaveCount(0);
  } finally {
    await stream.release();
  }
});
