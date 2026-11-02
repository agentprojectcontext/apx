// A turn's steps fold into "N pasos · time" and open into each step in words with the icon of its kind, hanging from
// one line; what the owner writes while it works stays where they wrote it, and the agent's answer to it comes below.
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
  const steps = page.locator(".turn__tools");
  await expect(steps).toHaveText(/1 paso · [0-9]+ s/);
  // Opened: the command in words, never the tool's id, with an icon and no check mark; it hangs from the line.
  await steps.getByRole("button", { name: /1 paso/ }).click();
  const row = steps.locator(".apx-actions__item");
  await expect(row).toContainText("sleep 3");
  await expect(row).not.toContainText("shell");
  await expect(row.locator(".apx-actions__itemicon svg")).toHaveCount(1);
  await expect(steps.locator(".apx-actions__list")).toHaveClass(/apx-branches/);
  await page.screenshot({ path: test.info().outputPath("steps-steer-desktop.png") });
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(page.getByText("Got it: use metric units")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("steps-steer-mobile.png") });
});
