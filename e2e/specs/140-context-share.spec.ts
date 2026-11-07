// How full the chat's context is, in the composer: a percentage of the model's window with a ring, and in its
// tooltip what happens when it fills.
import type { Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test, until } from "./kit.ts";

test("the composer shows how much of the model's context the chat uses", async ({ page }) => {
  await rpc("setup.finish");
  const thread = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "superagent", title: "Context" });
  // A model whose window APX knows (128k); the fake one reads 82k tokens for this message.
  await rpc("threads.model", { thread: thread.id, model_choice: { model: "custom/qwen-e2e", router: false } });
  await rpc("threads.send", { thread: thread.id, text: "Please fill the context" });
  await until(async () => {
    const { runs } = await rpc<{ runs: Array<{ usage?: { window?: number } }> }>("threads.get", { thread: thread.id });
    return runs[0]?.usage?.window === 128_000;
  });
  await open(page, `#thread=${thread.id}`);
  // The language's own percent ("64 %" in Spanish, whichever space it uses).
  const label =
    /^Contexto usado: 64\s?% \(82k de 128k\)\. Cuando se llena, se resume la parte más vieja de este chat\.$/;
  const chip = page.getByRole("button", { name: label });
  await expect(chip).toHaveText(/^64\s?%$/);
  await chip.hover();
  await expect(page.locator(".apx-tooltip").getByText(label)).toBeVisible();
  // On a phone the percentage stays beside the ring.
  await page.setViewportSize({ width: 375, height: 760 });
  await expect(chip).toBeVisible();
  await expect(chip.locator(".ctxchip__text")).toBeVisible();
});
