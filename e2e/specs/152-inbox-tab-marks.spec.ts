// The Inbox's tabs tell from outside what goes on in them: a spinner by the count while something in a tab runs, a dot
// over its name while it holds unread news the owner is not looking at.
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test("a tab shows a spinner while its chat runs and a dot for its news until it is shown", async ({ page }) => {
  // A core of its own: the shared world's chats run and get answers of their own, so its tabs never sit still.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const env = await startCore({
    port: 0,
    llm: scriptedLlm(async () => {
      await held;
      return say("Listo, ya está.");
    }),
  });
  try {
    await env.client.call("setup.finish", {});
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await page.goto(`${env.core.url}/`);
    const inbox = page.getByRole("region", { name: "Inbox" });
    const tab = (name: string) => inbox.getByRole("radio", { name: new RegExp(`^${name}`) });
    await tab("Tareas").click();
    await expect(tab("Tareas")).toBeChecked();

    await env.client.call("threads.send", { thread: chat.id, text: "revisá el contrato de Northwind" });
    await expect(tab("Chats").getByRole("img", { name: "1 en curso" })).toBeVisible();
    await expect(tab("Chats").locator(".apx-spinner")).toBeVisible();
    await expect(tab("Tareas").getByRole("img", { name: /en curso$/ })).toHaveCount(0);

    release();
    await env.settle(chat.id);
    await expect(tab("Chats").getByRole("img", { name: /en curso$/ })).toHaveCount(0);
    // Done: the same count, now what waits to be read, by a still dot instead of the spinner.
    await expect(tab("Chats").getByRole("img", { name: "1 sin leer" })).toBeVisible();
    await expect(tab("Chats").locator(".apx-spinner")).toHaveCount(0);
    await expect(tab("Tareas").getByRole("img", { name: /sin leer$/ })).toHaveCount(0);

    // Shown, the tab keeps its count until the chat is read.
    await tab("Chats").click();
    await expect(tab("Chats").getByRole("img", { name: "1 sin leer" })).toBeVisible();
    await expect(inbox.locator(".apx-convrow.is-unread")).toHaveCount(1);
  } finally {
    // A failed check must not leave the model held: closing the core waits for its run.
    release();
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
