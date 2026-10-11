// Unsent words stay with their chat, and a new chat is made in the core only with its first message.
import type { Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

/** Moves inside the app, as a link would: the page is not reloaded. */
const goTo = (page: Page, hash: string) =>
  page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
const chatCount = async () => (await rpc<{ threads: unknown[] }>("threads.list")).threads.length;

test("unsent words stay with their chat through moving around and a reload", async ({ page }) => {
  const other = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Aparte" });
  await open(page);
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("Half a thought for the super-agent");

  await goTo(page, `#thread=${other.id}`);
  await expect(page.getByRole("textbox", { name: "Escribile a Scout…" })).toHaveValue("");
  await box.fill("Another one for Scout");

  await goTo(page, "#thread=home");
  await expect(box).toHaveValue("Half a thought for the super-agent");
  await page.reload();
  await expect(box).toHaveValue("Half a thought for the super-agent");

  await goTo(page, `#thread=${other.id}`);
  await expect(box).toHaveValue("Another one for Scout");
  // A sent message is no draft any more.
  await box.press("Enter");
  await expect(page.getByText("Got it: Another one for Scout")).toBeVisible();
  await goTo(page, "#thread=home");
  await goTo(page, `#thread=${other.id}`);
  await expect(page.getByText("Got it: Another one for Scout")).toBeVisible();
  await expect(box).toHaveValue("");
});

test("a new chat is made only when its first message goes, and keeps its words until then", async ({ page }) => {
  await open(page);
  const before = await chatCount();
  const startWithScout = async () => {
    await page.getByRole("button", { name: "Nuevo chat" }).first().click();
    await page.getByRole("menuitem", { name: /Scout/ }).click();
  };
  const box = page.getByRole("textbox", { name: "Escribile a Scout…" });

  await startWithScout();
  await box.fill("Not sent yet");
  await goTo(page, "#thread=home");
  await expect(page.getByRole("textbox", { name: /^Escribile a/ })).toHaveValue("");
  expect(await chatCount()).toBe(before);

  // Opening a new chat with the same agent again finds what was left in it, also after a reload.
  await startWithScout();
  await expect(box).toHaveValue("Not sent yet");
  await page.reload();
  await expect(box).toHaveValue("Not sent yet");
  expect(await chatCount()).toBe(before);

  await box.press("Enter");
  await expect(page.getByRole("main").locator("p", { hasText: "Got it: Not sent yet" })).toBeVisible();
  expect(await chatCount()).toBe(before + 1);
  await expect(page).not.toHaveURL(/thread=new/);
  await expect(box).toHaveValue("");

  // The words went with the chat they made: the next new chat starts empty.
  await startWithScout();
  await expect(box).toHaveValue("");
  await expect(page.getByRole("main").locator("p", { hasText: "Got it: Not sent yet" })).toBeHidden();
});
