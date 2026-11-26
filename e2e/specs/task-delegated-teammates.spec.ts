// A task's agent often works it in another chat of the task than its home: the teammates it asks from there count on
// the task's row and unfold under it, and a limit notice says they keep going in the same conversation.

import { soFar } from "../../apps/core/src/engine/so-far.ts";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test("teammates asked from a task's working chat nest under its row, and their limit notice stays in place", async ({
  page,
}) => {
  const env = await startCore({
    port: Number(process.env.E2E_PORT ?? 7460) + 5,
    llm: scriptedLlm(async () => say("Done.")),
  });
  try {
    await env.client.call("setup.finish", {});
    const { store } = env.core;
    const agent = async (slug: string, name: string) =>
      (await env.client.call("agents.create", { slug, name })) as { id: string };
    const pia = await agent("pia", "Pia");
    const lorena = await agent("lorena", "Lorena");
    const fausto = await agent("fausto", "Fausto");
    const home = store.threads.create({ kind: "task", title: "Chat continuations", agent_ids: [pia.id] });
    const task = store.tasks.create({ title: "Chat continuations", status: "doing", thread_id: home.id, by: "owner" });
    const work = store.threads.create({
      kind: "loose",
      title: "Chat continuations",
      agent_ids: [pia.id],
      task_id: task.id,
    });
    store.messages.add({ thread_id: work.id, author: { kind: "user" }, parts: [{ type: "text", text: "Go on" }] });
    const ask = (who: { id: string }, title: string, session: string) =>
      store.threads.create({ kind: "a2a", title, agent_ids: [who.id], parent_id: work.id, session });
    ask(lorena, "Pia → Lorena: Design the chat continuations", "chat-continuations-design");
    const build = ask(fausto, "Pia → Fausto: Build the chat continuations", "chat-continuations-build");
    store.messages.add({
      thread_id: work.id,
      author: { kind: "system" },
      parts: [
        {
          type: "notice",
          level: "info",
          code: "delegation.limit",
          text: "Fausto hit the step limit.",
          vars: {
            variant: "continuedSteps",
            who: "Fausto",
            task: "Build the chat continuations",
            caller: "Pia",
            sofar: soFar(
              "**Avance**\n- Armé la lista de continuaciones y el botón para seguir.\n- Falta conectar el envío con el núcleo y probarlo en el teléfono, que lleva un rato más de trabajo.",
            ),
            subthread: build.id,
          },
        },
      ],
    });

    await page.goto(`${env.core.url}/#thread=${work.id}`);
    const notice = page.locator(".noticeline").filter({ hasText: "Fausto" });
    await expect(notice).toContainText("sigue en la misma conversación");
    await expect(notice).not.toContainText("chat-continuations-build");
    await expect(notice).not.toContainText("**");

    await page
      .getByRole("radiogroup", { name: "Mostrar" })
      .getByRole("radio", { name: /^Tareas/ })
      .click();
    const bundle = page.locator(".inbox__list .taskbundle", { hasText: "Chat continuations" });
    // The working chat and the two teammates it asked: three chats, and the row unfolds them.
    await expect(bundle.locator(".inboxtask__count").first()).toHaveText("3");
    await bundle.getByRole("button", { name: "Ver los chats de la tarea" }).click();
    await expect(bundle.locator(".tree__session")).toHaveCount(2);
    await expect(bundle.locator(".tree__session", { hasText: "Lorena" })).toBeVisible();
    // Opening a teammate's conversation shows it selected under its task.
    await bundle.locator(".tree__session", { hasText: "Fausto" }).click();
    await expect(page.locator(".chat__header")).toContainText("Fausto");
    await expect(bundle.locator(".tree__session.is-selected")).toContainText("Fausto");
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
