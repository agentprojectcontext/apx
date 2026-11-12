// An agent working a task asks a teammate on it (@mention in a task comment): the asker's chat shows the question as
// one card where it asked, its answer and the steps that failed, never a second copy of the answer. The task's
// conversation names the agent that works it, and the task's row counts every agent that took part and unfolds to the
// conversations of the teammates asked on it, each opening as the chat (D-222); the asker's chat lists them among the
// agents it called. Seen anywhere, beside the chat or as the chat, a teammate's conversation is read.
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { waitFor } from "../../apps/core/src/testkit/platform.ts";
import type { Tool } from "../../apps/core/src/tools/types.ts";
import { expect, test } from "./kit.ts";

const SHOTS = process.env.SHOTS;

/** A step with an effect that fails as it runs: what makes an answer's "some actions failed". */
const preview: Tool = {
  name: "deploy_preview",
  description: "Deploy a preview",
  parameters: { type: "object", properties: {} },
  parse: () => ({ ok: true, args: {} }),
  confirm: () => "never",
  effect: "local",
  deadlineMs: 5_000,
  title: () => "Deploy the preview",
  run: async () => {
    throw new Error("the preview server is down");
  },
};

test("a teammate asked on a task is one row where the asker asked, unfolding its answer and opening its conversation", async ({
  page,
}) => {
  let taskId = "";
  let asked = false;
  const env = await startCore({
    port: 0,
    extraTools: [preview],
    llm: scriptedLlm((req, { system, said, afterTool }) => {
      if (system.startsWith("You are Ramiro")) {
        if (said.includes("answered your question")) return say("Going on with the review.");
        if (afterTool) return say("Asked Bruno.");
        if (asked) return say("Still on it.");
        asked = true;
        return callTool("ask", "task_comment", { task: taskId, text: "@bruno review the finished diff, read only" });
      }
      if (system.startsWith("You are Bruno")) {
        if (!afterTool) return callTool("bad", "deploy_preview", {});
        if (req.messages.at(-1)?.role === "tool") return say("Approved: no blocking findings.");
      }
      return say("ok");
    }),
  });
  try {
    const store = env.core.store;
    await env.client.call("setup.finish", {});
    await env.client.call("agents.create", { slug: "ramiro", name: "Ramiro" });
    await env.client.call("agents.create", { slug: "bruno", name: "Bruno" });
    // Created with nobody on it (the super-agent holds its conversation), renamed, then given to Ramiro.
    const task = await env.client.call("tasks.create", {
      title: "Lead card hides company",
      description: "Fix the lead cards.",
    });
    taskId = task.id;
    await env.client.call("tasks.update", { task: task.id, title: "Lead cards ignore disabled attributes" });
    await env.client.call("tasks.update", { task: task.id, assignee: "ramiro" });
    const chat = () => store.threads.byTask(task.id).find((t) => t.agent_ids[0] === "ramiro");
    await waitFor(() => Boolean(chat()), "Ramiro's chat for the task");
    const shown = () =>
      store.messages
        .list(chat()?.id ?? "", 50)
        .flatMap((m) => m.parts)
        .find((p) => p.type === "subthread");
    await waitFor(() => shown()?.type === "subthread" && shown()?.state === "completed", "the card settles");
    await waitFor(
      () => store.runs.list(chat()?.id ?? "").some((r) => r.trigger === "a2a" && r.state === "completed"),
      "Ramiro goes on with the answer",
    );

    const card = shown();
    const bruno = card?.type === "subthread" ? card.thread_id : "";
    // One conversation with Bruno on the task: the card in Ramiro's chat and the task's point at the same one.
    expect(store.threads.sessions(task.thread_id).filter((t) => t.agent_ids[0] === "bruno")).toHaveLength(1);
    const unread = () => store.threads.get(bruno)?.unread ?? 0;
    // His conversation waits to be read.
    store.threads.patch(bruno, { unread: 1 }, false);

    await page.goto(`${env.core.url}/#thread=${chat()?.id}`);
    const transcript = page.locator(".transcript");
    const cards = transcript.locator(".apx-subthread");
    // One closed row where Ramiro asked: who asked whom and what, and how it went.
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Ramiro → Bruno");
    // What he was asked, without his own @mention: the row names him.
    await expect(cards).toContainText("review the finished diff, read only");
    await expect(cards).not.toContainText("@bruno");
    await expect(cards).toContainText("Fallaron algunas acciones");
    await expect(cards.locator(".apx-subthread__body")).toHaveCount(0);
    // Which steps failed, on its state.
    await expect(cards.getByTitle("Falló: Deploy the preview")).toBeVisible();
    // The answer is told once, folded in the row: not in a box with the words handed to Ramiro.
    await expect(transcript.locator(".transcript__agent-event, .transcript__answered")).toHaveCount(0);
    await expect(transcript).not.toContainText("answered your question");
    await expect(transcript).not.toContainText("Approved: no blocking findings.");
    await expect(transcript).toContainText("Going on with the review.");
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/asker-chat.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${SHOTS}/asker-chat-phone.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    // The row unfolds his answer and which steps failed, and folds it again.
    const head = cards.getByRole("button", { name: /Ramiro → Bruno/ });
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(cards).toContainText("Approved: no blocking findings.");
    await expect(cards.locator(".apx-subthread__meta")).toHaveText("Falló: Deploy the preview");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/asker-chat-open.png` });
    // At phone width the chat is drawn again, and the card stays unfolded.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(cards).toContainText("Approved: no blocking findings.");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/asker-chat-open-phone.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await head.click();
    await expect(cards.locator(".apx-subthread__body")).toHaveCount(0);
    await expect(transcript).not.toContainText("Approved: no blocking findings.");
    // Its foot opens Bruno's conversation beside the chat, as a delegation's does: the question, his steps, his answer.
    await head.click();
    await cards.getByRole("button", { name: "Abrir el chat de Bruno" }).click();
    const side = page.getByRole("complementary", { name: "Panel lateral" });
    await expect(side).toContainText("review the finished diff");
    await expect(side).toContainText("1 falló");
    await expect(side).toContainText("Approved: no blocking findings.");
    // Read beside the chat, it is read.
    await waitFor(() => unread() === 0, "his conversation is read once seen beside the chat");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/asker-side.png` });
    // The chat's agents list it as a teammate Ramiro called: who asked whom, how it ended and when; it opens again.
    await side.getByRole("tab", { name: /^Todos \(1\)/ }).click();
    const called = side.locator(".agents__row", { hasText: "Ramiro → Bruno" });
    await expect(called).toHaveCount(1);
    // Who was asked shows by name once: not again as the request's @mention.
    await expect(called).toContainText("Ramiro → Bruno: review the finished diff");
    await expect(called).not.toContainText("@bruno");
    await expect(called).toContainText("Listo");
    await expect(side).toContainText("Terminados (1)");
    await expect(side).not.toContainText("Este chat todavía no llamó a otros agentes");
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/asker-agents.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${SHOTS}/asker-agents-phone.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await called.click();
    await expect(side).toContainText("Approved: no blocking findings.");

    // The task's row counts both agents, and Ramiro's chat with Bruno's conversation.
    // Away from the chat where it was seen, his conversation has news again.
    await page.goto(`${env.core.url}/#view=inbox`);
    store.threads.patch(bruno, { unread: 1 }, false);
    await page
      .getByRole("radiogroup", { name: "Mostrar" })
      .getByRole("radio", { name: /^Tareas/ })
      .click();
    const row = page.locator(".taskbundle", { hasText: "Lead cards ignore disabled attributes" });
    await expect(row.getByTitle(/^2 agentes: .*Ramiro.*Bruno|^2 agentes: .*Bruno.*Ramiro/)).toBeVisible();
    await expect(row.getByTitle("2 chats")).toBeVisible();
    // It unfolds to the teammates asked on it: Bruno, with what Ramiro asked him.
    const teammate = row.locator(".tree__session", { hasText: "Bruno" });
    await expect(teammate).toHaveCount(0);
    await row.getByRole("button", { name: "Ver los chats de la tarea" }).click();
    await expect(teammate).toHaveCount(1);
    await expect(teammate).toContainText("review the finished diff, read only");
    await expect(teammate).not.toContainText("@bruno");
    await expect(teammate).not.toContainText("Ramiro →");
    // Unread, the row says so.
    await expect(teammate).toHaveClass(/is-unread/);
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/inbox-tasks.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Volver a los chats" }).click();
      await page.screenshot({ path: `${SHOTS}/inbox-tasks-phone.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    // A click opens his conversation as the chat, as a delegated chat under its caller does in Chats; read, the row
    // loses its mark.
    await teammate.click();
    await expect(page).toHaveURL(new RegExp(`thread=${bruno}`));
    await expect(page.locator(".chat__header")).toContainText("Ramiro → Bruno: review the finished diff");
    await expect(page.locator(".chat__header")).not.toContainText("@bruno");
    await expect(page.locator(".chat .transcript").first()).toContainText("Approved: no blocking findings.");
    await expect(teammate).toHaveClass(/is-selected/);
    await expect(teammate).not.toHaveClass(/is-unread/);
    await waitFor(() => unread() === 0, "his conversation is read once opened from the task's row");
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/inbox-teammate-open.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${SHOTS}/inbox-teammate-open-phone.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
    }

    // The task's conversation is Ramiro's task, under its current title.
    await page.goto(`${env.core.url}/#thread=${task.thread_id}`);
    const header = page.locator(".chat__header");
    await expect(header).toContainText("Lead cards ignore disabled attributes");
    await expect(header).toContainText("Ramiro");
    await expect(header).not.toContainText("Super-agente");
    // There too, the teammate's card is its row.
    const taskCard = page.locator(".transcript .apx-subthread");
    await expect(taskCard).toHaveCount(1);
    await expect(taskCard).toContainText("Ramiro → Bruno");
    await expect(taskCard).toContainText("Lead cards ignore disabled attributes");
    // Left unfolded in Ramiro's chat, it is unfolded here too; its row folds it.
    await expect(taskCard).toContainText("Approved: no blocking findings.");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/task-conversation-open.png` });
    await taskCard.locator(".apx-subthread__head").click();
    await expect(taskCard.locator(".apx-subthread__body")).toHaveCount(0);
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/task-conversation.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${SHOTS}/task-conversation-phone.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

test("an answer that reached a chat without its card shows as that closed row, once", async ({ page }) => {
  const env = await startCore({ port: 0, llm: scriptedLlm(() => say("ok")) });
  try {
    const store = env.core.store;
    await env.client.call("setup.finish", {});
    await env.client.call("agents.create", { slug: "ramiro", name: "Ramiro" });
    await env.client.call("agents.create", { slug: "bruno", name: "Bruno" });
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "ramiro" });
    // As answers were kept before the asker's chat held the card (and as they still reach a chat asked from elsewhere).
    store.messages.add({
      thread_id: chat.id,
      author: { kind: "agent", id: "bruno" },
      parts: [
        {
          type: "text",
          text: "Bruno answered your question on task task_1:\nUse the staging database.\n\nGo on with the task.",
          response: {
            thread_id: chat.id,
            run_id: "run_1",
            task_id: "task_1",
            title: "Lead cards ignore disabled attributes",
            state: "completed",
            issue: "actions_failed",
            failed: ["Updated task task_nope"],
          },
        },
      ],
    });
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    const card = page.locator(".transcript .apx-subthread");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Ramiro → Bruno");
    await expect(card).toContainText("Lead cards ignore disabled attributes");
    await expect(card).toContainText("Fallaron algunas acciones");
    await expect(card.getByTitle("Falló: Updated task task_nope")).toBeVisible();
    await expect(card).not.toContainText("Use the staging database.");
    await expect(page.locator(".transcript__agent-event")).toHaveCount(0);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
