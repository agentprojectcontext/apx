import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { waitFor } from "../../apps/core/src/testkit/platform.ts";
import { expect, test } from "./kit.ts";

test("task consult replies arrive as traced events, survive reload and do not turn the chat into a group", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let task = "";
  const env = await startCore({
    port: 0,
    llm: scriptedLlm(async (_req, { system, said, afterTool }) => {
      if (system.startsWith("You are Helper")) {
        await held;
        return say("Consult evidence: tests passed.");
      }
      if (!afterTool && said === "Ask for a review")
        return callTool("consult", "task_comment", { task, text: "@helper check the tests" });
      return say(
        said.includes("answered your question")
          ? "Holder consolidated the report."
          : "Holder is waiting for the review.",
      );
    }),
  });
  try {
    await env.client.call("setup.finish", {});
    await env.client.call("agents.update", { agent: "roby", name: "Holder" });
    const helper = await env.client.call("agents.create", { slug: "helper", name: "Helper" });
    const created = await env.client.call("tasks.create", { title: "Check the launch" });
    task = created.id;
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    await env.client.call("threads.send", { thread: chat.id, text: "Ask for a review" });
    await env.settle(chat.id);
    await expect(page.locator(".transcript")).toContainText("Holder is waiting for the review.");
    await expect(page.locator(".transcript__agent-event")).toHaveCount(0);
    release();
    const event = page.locator(".transcript__agent-event");
    await expect(event.locator("summary")).toContainText("Respuesta de Helper");
    await expect(event).toContainText("Consult evidence: tests passed.");
    await expect(event.locator(".turn__agentbtn")).toHaveCount(0);
    await expect(page.locator(".transcript > .transcript__row .apx-subthread")).toHaveCount(0);
    await expect(page.locator(".transcript")).toContainText("Holder consolidated the report.");
    await expect(page.getByText("Consult evidence: tests passed.", { exact: false })).toHaveCount(1);
    await event.locator("summary").click();
    await expect(event.locator(".transcript__event-body")).not.toBeVisible();
    await event.locator("summary").press("Enter");
    await expect(event.locator(".transcript__event-body")).toBeVisible();
    await page.reload();
    await expect(event.locator("summary")).toContainText("Respuesta de Helper");
    await expect(event).toContainText("Consult evidence: tests passed.");
    const loaded = await env.client.call("threads.get", { thread: chat.id });
    expect(loaded.thread.agent_ids).toEqual(["roby"]);
    const response = loaded.messages.flatMap((m) =>
      m.parts.flatMap((p) => (p.type === "text" && p.response ? [p.response] : [])),
    )[0];
    expect(response?.task_id).toBe(task);
    await event.getByRole("button", { name: /Abrir conversación con Helper/ }).click();
    await expect(page).toHaveURL(/panel=processes/);
    await expect(page.getByRole("complementary", { name: "Panel lateral" })).toContainText(
      "Consult evidence: tests passed.",
    );
    expect(response?.thread_id).toBe(env.core.store.threads.children(created.thread_id)[0]);

    // Legacy/proactive messages have no trustworthy response link; other agents stay distinct events.
    const other = await env.client.call("agents.create", { slug: "other", name: "Other helper" });
    for (const id of [helper.id, other.id])
      env.core.store.messages.add({
        thread_id: chat.id,
        author: { kind: "agent", id },
        parts: [{ type: "text", text: `Historical message ${id}` }],
      });
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    await expect(page.locator(".transcript__agent-event")).toHaveCount(3);
    await expect(page.locator(".transcript__agent-event > summary", { hasText: "Mensaje de Helper" })).toHaveCount(1);
    await expect(
      page.locator(".transcript__agent-event > summary", { hasText: "Mensaje de Other helper" }),
    ).toHaveCount(1);
    await expect(page.locator(".transcript__event-source")).toHaveCount(1);

    for (const kind of ["group", "a2a", "task", "channel"] as const) {
      const group = env.core.store.threads.create({
        kind,
        title: `Team ${kind}`,
        agent_ids: ["roby", helper.id],
        ...(kind === "a2a" ? { parent_id: chat.id } : {}),
      });
      for (const id of ["roby", helper.id])
        env.core.store.messages.add({
          thread_id: group.id,
          author: { kind: "agent", id },
          parts: [{ type: "text", text: `Participant ${id}` }],
        });
      await page.goto(`${env.core.url}/#thread=${group.id}`);
      await expect(page.locator(".transcript__agent-event")).toHaveCount(0);
      await expect(page.locator(".transcript .turn__agentbtn")).toHaveCount(2);
    }
    await waitFor(() => env.core.store.runs.list(chat.id).every((r) => r.ended_at), "the holder finished");
  } finally {
    release();
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

for (const outcome of ["empty", "failed", "step_limit"] as const) {
  test(`a ${outcome} consult keeps its outcome from the core through reload`, async ({ page }) => {
    let task = "";
    const env = await startCore({
      port: 0,
      llm: scriptedLlm((req, { system, said, afterTool }) => {
        if (system.startsWith("You are Helper")) {
          if (outcome === "failed") throw new Error("Consult unavailable");
          if (outcome === "step_limit")
            return req.tools.length
              ? callTool(`search${req.messages.length}`, "memory_search", {
                  query: `Review change ${req.messages.length}`,
                })
              : say("Progress before the step limit.");
          return say("");
        }
        if (!afterTool && said === "Check the outcome")
          return callTool("consult", "task_comment", { task, text: "@helper check the change" });
        return say("Holder received the outcome.");
      }),
    });
    try {
      await env.client.call("setup.finish", {});
      await env.client.call("agents.create", { slug: "helper", name: "Helper" });
      const created = await env.client.call("tasks.create", { title: "Check the outcome" });
      task = created.id;
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
      await page.goto(`${env.core.url}/#thread=${chat.id}`);
      await env.client.call("threads.send", { thread: chat.id, text: "Check the outcome" });
      const event = page.locator(".transcript__agent-event");
      const title = outcome === "step_limit" ? "Avance de Helper" : "Mensaje de Helper";
      const status = outcome === "empty" ? "Terminó sin respuesta" : outcome === "failed" ? "Falló" : "Sin pasos";
      await expect(event.locator("summary")).toContainText(title);
      await expect(event).toContainText(status);
      await expect(event.locator("summary")).not.toContainText("Respuesta de");
      await page.reload();
      await expect(event.locator("summary")).toContainText(title);
      await expect(event).toContainText(status);
      const loaded = await env.client.call("threads.get", { thread: chat.id });
      const response = loaded.messages.flatMap((m) =>
        m.parts.flatMap((p) => (p.type === "text" && p.response ? [p.response] : [])),
      )[0];
      expect(response?.thread_id).toBe(env.core.store.threads.children(created.thread_id)[0]);
      if (outcome === "empty") expect(response?.issue).toBe("no_answer");
      else expect(response?.end_reason).toBe(outcome);
      await page.goto(`${env.core.url}/#thread=${created.thread_id}`);
      const card = page.locator(".transcript .apx-subthread");
      await expect(card).toContainText(status);
      await expect(card).toContainText(title);
      await env.settle(chat.id);
    } finally {
      await page.goto("about:blank");
      await env.core.close();
      await env.cleanup();
    }
  });
}
