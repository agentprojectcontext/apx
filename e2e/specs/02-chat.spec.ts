// Talking to the super-agent from the panel: the message goes out, the (fake) model answers, the chat keeps both.
import { expect, open, rpc, test, world } from "./kit.ts";

test("the owner writes to the super-agent and the answer streams in", async ({ page }) => {
  await open(page);
  const before = await world.llmCalls();
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("What is on today?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("Got it: What is on today?")).toBeVisible();
  expect(await world.llmCalls()).toBeGreaterThan(before);
  await expect(box).toHaveValue("");

  // A reload brings the same chat back.
  await page.reload();
  await expect(page.getByText("Got it: What is on today?")).toBeVisible();
});

test("a new chat starts empty and keeps its own conversation", async ({ page }) => {
  await open(page);
  const count = (await rpc<{ threads: unknown[] }>("threads.list")).threads.length;
  await page.getByRole("button", { name: "Nuevo chat" }).first().click();
  await page.getByRole("menuitem", { name: /Scout/ }).click();
  await expect(page.getByRole("textbox", { name: "Escribile a Scout…" })).toBeVisible();
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("Second chat");
  await box.press("Enter");
  await expect(page.getByRole("main").locator("p", { hasText: "Got it: Second chat" })).toBeVisible();
  expect((await rpc<{ threads: unknown[] }>("threads.list")).threads.length).toBeGreaterThan(count);
});
