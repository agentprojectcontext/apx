import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

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
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    await env.client.call("threads.send", { thread: chat.id, text: "Consult both helpers" });
    await env.settle(chat.id);
    const cards = page.locator(".transcript .apx-subthread");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("Respuesta de Alpha");
    await expect(cards.nth(0)).toContainText("Alpha report:");
    await expect(cards.nth(0)).toContainText("unknown tool delegate");
    await expect(cards.nth(1)).toContainText("Respuesta de Beta");
    await expect(cards.nth(1)).toContainText("Beta report: checked independently.");
    await expect(page.locator(".transcript__agent-event")).toHaveCount(0);
    await expect(page.locator(".transcript .turn__agentbtn")).toHaveCount(0);
    const children = env.core.store.threads.children(chat.id);
    expect(children).toHaveLength(2);
    for (const id of children) expect(env.core.store.threads.children(id)).toHaveLength(0);
    await cards.nth(0).getByRole("button", { name: "Abrir conversación con Alpha" }).click();
    await expect(page.getByRole("complementary", { name: "Panel lateral" })).toContainText("Alpha report");
    const alpha = children.find((id) => env.core.store.threads.get(id)?.agent_ids[0] === "alpha");
    expect(alpha).toBeTruthy();
    const nested = (await env.client.call("threads.get", { thread: alpha ?? "" })).messages;
    expect(JSON.stringify(nested)).toMatch("unknown tool delegate");
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    await page.reload();
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("Respuesta de Alpha");
    await expect(cards.nth(1)).toContainText("Respuesta de Beta");
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
