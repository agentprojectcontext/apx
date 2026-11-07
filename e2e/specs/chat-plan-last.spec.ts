// A turn's plan stays under everything the agent shows while it works, and once every step is marked done it keeps
// that place: the answer written after it comes below. A newer plan in the chat replaces it.
import { expect, open, rpc, test } from "./kit.ts";

test("the plan is drawn last while the turn works and stays above the answer written after it", async ({ page }) => {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Plan" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill("plan two checks");
  await page.keyboard.press("Enter");

  const turn = page.locator(".turn").last();
  await expect(page.locator(".plancard")).toContainText("0 de 2 hechos", { timeout: 15_000 });
  // The worker's card came after the plan was written, yet the plan is still at the bottom.
  await expect(turn.locator(".apx-msg")).toHaveCount(2, { timeout: 15_000 });
  await expect(turn.locator(".apx-msg").last().locator(".plancard")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("plan-last-working.png") });

  await expect(page.getByText("Got it: plan two checks")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".plancard")).toContainText("2 de 2 hechos");
  const order = await turn
    .locator(".apx-msg")
    .evaluateAll((els) => els.map((e) => (e.querySelector(".plancard") ? "plan" : (e.textContent ?? "").trim())));
  expect(order.indexOf("plan")).toBe(order.length - 2);
  expect(order.at(-1)).toContain("Got it: plan two checks");

  // A new plan in the same chat replaces the one above: only the newest shows.
  await page.getByRole("textbox", { name: /Escribile/ }).fill("plan two checks again");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Got it: plan two checks again")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".plancard")).toHaveCount(1);
  await expect(page.locator(".turn").last().locator(".plancard")).toBeVisible();
  await page.locator(".chat__scroll").evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.screenshot({ path: test.info().outputPath("plan-last-done-desktop.png") });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.locator(".chat__scroll").evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.screenshot({ path: test.info().outputPath("plan-last-done-mobile.png") });
});
