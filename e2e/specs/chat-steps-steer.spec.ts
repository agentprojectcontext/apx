// A turn's steps fold into "N pasos · time"; what the owner writes while it works stays where they wrote it, and the
// agent's answer to it comes below.
import { expect, open, rpc, test } from "./kit.ts";

test("the owner's words mid-turn stay in order, and the folded steps say how many and how long", async ({ page }) => {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Pasos" });
  await open(page, `#thread=${chat.id}`);
  const box = page.getByRole("textbox", { name: /Escribile/ });
  await box.fill("work for a moment");
  await page.keyboard.press("Enter");
  await expect(page.locator(".turn__tools")).toContainText("Trabajando · paso 1");

  // Written while the agent works: it reaches the running turn.
  await box.fill("use metric units");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Got it: use metric units")).toBeVisible({ timeout: 15_000 });

  const order = await page
    .locator(".apx-msg")
    .evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
  const at = (text: string) => order.findIndex((t) => t.includes(text));
  expect(at("use metric units")).toBeGreaterThan(at("work for a moment"));
  expect(at("Got it: use metric units")).toBeGreaterThan(at("use metric units"));
  await expect(page.locator(".turn__tools")).toHaveText(/1 paso · [0-9]+ s/);
  await page.screenshot({ path: test.info().outputPath("steps-steer-desktop.png") });
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(page.getByText("Got it: use metric units")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("steps-steer-mobile.png") });
});
