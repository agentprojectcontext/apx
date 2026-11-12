// An agent working a task asks a teammate on it (@mention in a task comment): the asker's chat shows the question as
// one card where it asked, its answer and the steps that failed, never a second copy of the answer. The task's
// conversation names the agent that works it, and the task's row counts every agent that took part and unfolds to the
// conversations of the teammates asked on it.
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

test("a teammate asked on a task is one closed row where the asker asked, opening its conversation", async ({
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

    await page.goto(`${env.core.url}/#thread=${chat()?.id}`);
    const transcript = page.locator(".transcript");
    const cards = transcript.locator(".apx-subthread");
    // One closed row where Ramiro asked: who asked whom and what, and how it went.
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Ramiro → Bruno");
    await expect(cards).toContainText("@bruno review the finished diff, read only");
    await expect(cards).toContainText("Fallaron algunas acciones");
    await expect(cards.locator(".apx-subthread__report, .apx-subthread__meta")).toHaveCount(0);
    // Which steps failed, on its state.
    await expect(cards.getByTitle("Falló: Deploy the preview")).toBeVisible();
    // The answer is told once, in Bruno's conversation: not in the row, nor in a box with the words handed to Ramiro.
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
    // A click opens Bruno's conversation beside the chat, as a delegation's row does: the question, his steps, his answer.
    await cards.getByRole("button", { name: "Abrir conversación con Bruno" }).click();
    const side = page.getByRole("complementary", { name: "Panel lateral" });
    await expect(side).toContainText("review the finished diff");
    await expect(side).toContainText("1 falló");
    await expect(side).toContainText("Approved: no blocking findings.");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/asker-side.png` });

    // The task's row counts both agents, and Ramiro's chat with Bruno's conversation.
    await page.goto(`${env.core.url}/#view=inbox`);
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
    await expect(teammate).toContainText("@bruno review the finished diff, read only");
    await expect(teammate).not.toContainText("Ramiro →");
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/inbox-tasks.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Volver a los chats" }).click();
      await page.screenshot({ path: `${SHOTS}/inbox-tasks-phone.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    // A click opens his conversation beside the task's, as the row in the task's conversation does.
    await teammate.click();
    await expect(page.locator(".chat__header")).toContainText("Lead cards ignore disabled attributes");
    const beside = page.getByRole("complementary", { name: "Panel lateral" });
    await expect(beside).toContainText("Approved: no blocking findings.");
    await expect(teammate).toHaveClass(/is-selected/);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/inbox-teammate-open.png` });

    // The task's conversation is Ramiro's task, under its current title.
    await page.goto(`${env.core.url}/#thread=${task.thread_id}`);
    const header = page.locator(".chat__header");
    await expect(header).toContainText("Lead cards ignore disabled attributes");
    await expect(header).toContainText("Ramiro");
    await expect(header).not.toContainText("Super-agente");
    // There too, the teammate's card is its closed row.
    const taskCard = page.locator(".transcript .apx-subthread");
    await expect(taskCard).toHaveCount(1);
    await expect(taskCard).toContainText("Ramiro → Bruno");
    await expect(taskCard).toContainText("Lead cards ignore disabled attributes");
    await expect(taskCard.locator(".apx-subthread__report")).toHaveCount(0);
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
