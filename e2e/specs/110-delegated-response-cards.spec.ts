import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

const SHOTS = process.env.SHOTS;

test("multiple delegated reports remain separate cards and nested requests do not invent participants", async ({
  page,
}) => {
  let holderCalls = 0;
  const env = await startCore({
    port: 0,
    llm: scriptedLlm((req, { system, afterTool }) => {
      if (system.startsWith("You are Alpha")) {
        if (!afterTool) return callTool("nested", "delegate", { agent: "beta", task: "Nested request" });
        return say(`Alpha report: ${String(req.messages.at(-1)?.content)}`);
      }
      if (system.startsWith("You are Beta")) return say("Beta report: checked independently.");
      const step = holderCalls++;
      if (step < 2)
        return callTool(`delegate-${step}`, "delegate", {
          agent: step === 0 ? "alpha" : "beta",
          task: "Check the change",
          wait_s: 5,
        });
      return say("Holder consolidated both reports.");
    }),
  });
  try {
    await env.client.call("setup.finish", {});
    await env.client.call("agents.create", { slug: "alpha", name: "Alpha" });
    await env.client.call("agents.create", { slug: "beta", name: "Beta" });
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    await env.client.call("threads.send", { thread: chat.id, text: "Consult both helpers" });
    await env.settle(chat.id);
    const cards = page.locator(".transcript .apx-subthread");
    await expect(cards).toHaveCount(2);
    // Each is its own row, closed: the row unfolds its report.
    await expect(cards.nth(0)).toContainText("→ Alpha");
    await expect(cards.nth(1)).toContainText("→ Beta");
    await expect(cards).not.toContainText(["Alpha report:", "Beta report:"]);
    for (const i of [0, 1]) await cards.nth(i).locator(".apx-subthread__head").click();
    await expect(cards.nth(0)).toContainText("Alpha report:");
    await expect(cards.nth(0)).toContainText("unknown tool delegate");
    await expect(cards.nth(1)).toContainText("Beta report: checked independently.");
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/delegations-open.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await cards.nth(1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/delegations-open-phone.png` });
      await cards.nth(0).locator(".apx-subthread__head").click();
      await cards.nth(1).locator(".apx-subthread__head").click();
      await page.screenshot({ path: `${SHOTS}/delegations-phone.png` });
      await cards.nth(0).locator(".apx-subthread__head").click();
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await expect(page.locator(".transcript__agent-event")).toHaveCount(0);
    await expect(page.locator(".transcript .turn__agentbtn")).toHaveCount(0);
    const children = env.core.store.threads.children(chat.id);
    expect(children).toHaveLength(2);
    for (const id of children) expect(env.core.store.threads.children(id)).toHaveLength(0);
    await cards.nth(0).getByRole("button", { name: "Abrir el chat de Alpha" }).click();
    await expect(page.getByRole("complementary", { name: "Panel lateral" })).toContainText("Alpha report");
    const alpha = children.find((id) => env.core.store.threads.get(id)?.agent_ids[0] === "alpha");
    expect(alpha).toBeTruthy();
    const nested = (await env.client.call("threads.get", { thread: alpha ?? "" })).messages;
    expect(JSON.stringify(nested)).toMatch("unknown tool delegate");
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    await page.reload();
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("→ Alpha");
    await expect(cards.nth(1)).toContainText("→ Beta");
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
