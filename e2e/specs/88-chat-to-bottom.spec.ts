// Scrolled up in a long chat, a button floats over the composer and takes the reader back to the latest message.
import { expect, open, rpc, test } from "./kit.ts";

test("scrolled up, a button goes back to the latest message and hides there", async ({ page }) => {
  await rpc("setup.finish", {});
  const t = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Long read" });
  const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of the Northwind notes`).join("\n");
  await rpc("threads.send", { thread: t.id, text: lines });
  await page.setViewportSize({ width: 1024, height: 640 });
  await open(page, `#view=inbox&thread=${t.id}`);

  const scroller = page.getByRole("main").locator(".chat__scroll");
  const toBottom = page.getByRole("button", { name: "Ir al último mensaje" });
  const atEnd = () => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2);
  // The owner's message, not the reply that may quote its last line.
  await expect(page.getByText("Line 60 of the Northwind notes").first()).toBeInViewport();
  await expect.poll(atEnd).toBe(true);
  await expect(toBottom).toBeHidden();

  await scroller.hover();
  await page.mouse.wheel(0, -10000);
  await expect(toBottom).toBeVisible();
  await expect(toBottom).toBeInViewport();

  await toBottom.click();
  await expect.poll(atEnd).toBe(true);
  await expect(toBottom).toBeHidden();
});
