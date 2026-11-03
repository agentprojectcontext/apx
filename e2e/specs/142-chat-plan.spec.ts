import net, { type AddressInfo } from "node:net";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

// Work of several steps starts with a plan: the owner sees it under the agent's message as a checklist that changes
// as the agent marks its steps (DECISIONS.md#d-191).
test("the agent's plan shows under its message and updates as it marks steps", async ({ page }) => {
  test.setTimeout(60_000);
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  let release = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const env = await startCore({
    port,
    llm: scriptedLlm(async (req, { said, afterTool }) => {
      if (!said.includes("Rewrite the landing page")) return say("Noted.");
      const turn = req.messages.findLastIndex((m) => m.role === "user" && !String(m.content).startsWith("<system"));
      const done = req.messages.slice(turn).filter((m) => m.role === "tool").length;
      if (!afterTool)
        return callTool("p1", "plan", {
          steps: "- [~] Read the current page\n- [ ] Write the new copy\n- [ ] Check it on a phone",
        });
      if (done === 1) {
        await next;
        return callTool("p2", "plan", {
          steps: "- [x] Read the current page\n- [x] Write the new copy\n- [~] Check it on a phone",
        });
      }
      return say("The new copy is written; I am checking it on a phone now.");
    }),
  });
  try {
    await env.client.call("setup.finish", {});
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Landing" });
    await page.goto(`${env.core.url}#thread=${chat.id}`);
    const box = page.getByRole("textbox", { name: /Escribile/ });
    await box.fill("Rewrite the landing page copy");
    await page.keyboard.press("Enter");

    // The plan appears while the agent works: the first step under way, none done.
    const plan = page.getByRole("region", { name: "Plan", exact: true });
    await expect(plan).toContainText("0 de 3 hechos");
    await expect(plan.locator(".apx-steps__row")).toHaveCount(3);
    await expect(plan.locator(".apx-steps__row.is-running")).toHaveText("Read the current page");
    await page.screenshot({ path: test.info().outputPath("chat-plan-working.png") });

    // The agent marks two steps done: the same checklist changes in place.
    release();
    await expect(plan).toContainText("2 de 3 hechos");
    await expect(plan.locator(".apx-steps__row.is-done")).toHaveCount(2);
    await expect(plan.locator(".apx-steps__row.is-running")).toHaveText("Check it on a phone");
    await expect(page.getByText("The new copy is written")).toBeVisible();
    await expect(page.getByRole("region", { name: "Plan", exact: true })).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath("chat-plan-desktop.png") });
    await page.setViewportSize({ width: 375, height: 760 });
    await expect(plan).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("chat-plan-phone.png") });
  } finally {
    release();
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
