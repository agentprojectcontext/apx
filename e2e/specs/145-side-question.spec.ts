// A side question (DECISIONS.md#d-208): from the composer's + the owner asks the chat's agent something quick, the
// answer shows over the composer only, and nothing of it enters the chat.
import type { Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test, until } from "./kit.ts";

type Got = { messages: unknown[]; runs: Array<{ state: string }> };

test("a side question is answered over the composer and never enters the chat", async ({ page }) => {
  await rpc("setup.finish");
  const chat = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "superagent", title: "Aparte" });
  await rpc("threads.send", { thread: chat.id, text: "The codeword is Northwind" });
  const settled = await until(async () => {
    const got = await rpc<Got>("threads.get", { thread: chat.id });
    return got.runs.length > 0 && got.runs.every((r) => r.state === "completed") && got;
  });
  const before = (await rpc<{ threads: Thread[] }>("threads.list", {})).threads.length;

  await open(page, `#thread=${chat.id}`);
  const transcript = page.locator(".transcript");
  await expect(transcript).toContainText("Got it: The codeword is Northwind");

  // The + menu (its name changes with the composer's design) offers it, with what it means.
  await page
    .locator(".chat__composer")
    .getByRole("button", { name: /^(Adjuntar|Agregar)$/ })
    .click();
  const item = page.getByRole("menuitem", { name: /Pregunta aparte/ });
  await expect(item).toContainText("No entra en el hilo");
  await item.click();

  const aside = page.getByRole("region", { name: "Pregunta aparte" });
  await expect(aside).toContainText("Algo rápido sobre este chat");
  const field = aside.getByRole("textbox", { name: /Preguntale a/ });
  await expect(field).toBeFocused();
  await field.fill("Which codeword?");
  await page.keyboard.press("Enter");
  await expect(aside).toContainText("Got it: Side question: Which codeword?");
  // A follow-up goes on the same side conversation.
  await field.fill("And in capitals?");
  await page.keyboard.press("Enter");
  await expect(aside).toContainText("Got it: And in capitals?");
  await page.screenshot({ path: test.info().outputPath("side-question-desktop.png") });
  await page.setViewportSize({ width: 375, height: 760 });
  await expect(field).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("side-question-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 800 });

  // The chat is as it was: no message, no turn, no other chat in the Inbox.
  await expect(transcript).not.toContainText("Which codeword?");
  const after = await rpc<Got>("threads.get", { thread: chat.id });
  expect(after.messages.length).toBe(settled.messages.length);
  expect(after.runs.length).toBe(settled.runs.length);
  expect((await rpc<{ threads: Thread[] }>("threads.list", {})).threads.length).toBe(before);

  // Esc closes it, and the side conversation goes with it.
  await field.press("Escape");
  await expect(aside).toHaveCount(0);
  await page
    .locator(".chat__composer")
    .getByRole("button", { name: /^(Adjuntar|Agregar)$/ })
    .click();
  await page.getByRole("menuitem", { name: /Pregunta aparte/ }).click();
  await expect(aside).not.toContainText("Which codeword?");
  await aside.getByRole("button", { name: "Cerrar la pregunta aparte" }).click();
  await expect(aside).toHaveCount(0);
});
