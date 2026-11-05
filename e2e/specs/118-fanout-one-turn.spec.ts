// Three helpers asked in one turn answer a few seconds apart: the cards of those in say how many answers are in,
// and the agent reads all three in one turn, which shows the three cards again (DECISIONS.md#d-194).
import type { Agent, Run, Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

for (const width of [1440, 390]) {
  test(`answers of helpers asked together reach the agent in one turn (${width}px)`, async ({ page }, info) => {
    await rpc("setup.finish");
    const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
    const agent = agents.find((a) => a.kind === "secretary");
    if (!agent) throw new Error("Missing super-agent");
    const root = await rpc<Thread>("threads.create", { kind: "loose", agent_id: agent.id, title: "Three parts" });
    await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
    await open(page, `#thread=${root.id}`);
    const chat = page.locator(".transcript").last();
    await rpc("threads.send", { thread: root.id, text: "ask three staggered workers" });

    const cards = chat.locator(".apx-subthread");
    await expect(cards).toHaveCount(3);
    // The first two are in and wait for the third, which still works.
    await expect(cards.getByText("Esperando respuestas: 2 de 3")).toHaveCount(2, { timeout: 15_000 });
    await expect(cards.nth(2).getByText("Esperando respuestas", { exact: false })).toHaveCount(0);
    await cards.nth(1).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`fanout-waiting-${width}.png`), fullPage: false });

    // One turn with all three: their cards show again above what the agent made of them.
    await expect(cards).toHaveCount(6, { timeout: 15_000 });
    await expect(cards.getByText("Esperando respuestas", { exact: false })).toHaveCount(0);
    await expect(cards.getByText("Listo", { exact: true })).toHaveCount(6);
    const { runs } = await rpc<{ runs: Run[] }>("threads.get", { thread: root.id });
    expect(runs.filter((r) => r.trigger === "a2a_result")).toHaveLength(1);
    await cards.nth(5).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`fanout-one-turn-${width}.png`), fullPage: false });
  });
}
