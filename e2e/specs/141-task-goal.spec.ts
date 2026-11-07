import net, { type AddressInfo } from "node:net";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

// The owner asks in a chat; the super-agent hands the work on. The task shows where it must arrive, the owner's words
// as written, and its agent's plan as steps (DECISIONS.md#d-187).
test("a task shows its goal, what the owner asked and its plan as steps", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const asked = "The cursor in the reference moves smooth and animated, it must look like that";
  const env = await startCore({
    port,
    llm: scriptedLlm((_req, { said, afterTool }) => {
      if (afterTool) return say("Handed on.");
      if (said.includes(asked))
        return callTool("create", "task_create", {
          title: "Smooth pointer",
          goal: "Computer use moves like the reference: an animated cursor per agent",
          description: "## Context\n- The reference draws its cursor\n- The real pointer jumps in two steps",
        });
      return say("Noted.");
    }),
  });
  try {
    await env.client.call("setup.finish", {});
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await env.client.call("threads.send", { thread: chat.id, text: asked });
    let id = "";
    await expect
      .poll(async () => {
        id = (await env.client.call("tasks.list", {})).tasks.find((t) => t.title === "Smooth pointer")?.id ?? "";
        return id;
      })
      .not.toBe("");
    await env.client.call("tasks.update", {
      task: id,
      plan: "- [x] Read the reference\n- [~] Draw the cursor\n- [ ] Record the video",
    });

    await page.goto(env.core.url);
    await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
    await page.getByText("Smooth pointer", { exact: true }).click();
    const drawer = page.getByRole("complementary", { name: "Smooth pointer" });
    await expect(drawer.getByRole("textbox", { name: "Objetivo", exact: true })).toHaveValue(
      "Computer use moves like the reference: an animated cursor per agent",
    );
    const words = drawer.getByRole("region", { name: "Lo que pediste" });
    await expect(words).toContainText(asked);
    await expect(words).toContainText("a Roby");
    // The description reads formatted; the plan, as steps with how many are done.
    const brief = drawer.locator(".taskdetail__descview");
    await expect(brief.getByRole("heading", { name: "Context" })).toBeVisible();
    await expect(brief).not.toContainText("##");
    await expect(drawer.locator(".taskdetail__descview li")).toHaveCount(2);
    const plan = drawer.getByRole("region", { name: "Plan del agente" });
    await expect(plan).toContainText("1 de 3 hechos");
    await expect(plan.locator(".apx-steps__row")).toHaveCount(3);
    await expect(plan.locator(".apx-steps__row.is-running")).toHaveText("Draw the cursor");

    // The owner sets a goal of their own: it is what the task keeps.
    const goal = drawer.getByRole("textbox", { name: "Objetivo", exact: true });
    await goal.fill("The cursor glides like the reference");
    await goal.blur();
    await expect
      .poll(async () => (await env.client.call("tasks.get", { task: id })).task.goal)
      .toBe("The cursor glides like the reference");
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
