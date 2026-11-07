// Past the delegations a chat may run at once, the next ones wait: their cards and the chat's processes show them
// as queued, and they start and report back as slots free.
import { MAX_ACTIVE_DELEGATIONS } from "../../apps/core/src/engine/limits.ts";
import type { Agent, Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

/** Four workers asked at once: those past the cap wait. */
const QUEUED = 4 - MAX_ACTIVE_DELEGATIONS;

test("delegations past the cap show as queued, then run as the others end", async ({ page }) => {
  await rpc("setup.finish");
  const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
  const agent = agents.find((a) => a.kind === "secretary");
  if (!agent) throw new Error("Missing super-agent");
  const root = await rpc<Thread>("threads.create", { kind: "loose", agent_id: agent.id, title: "Four parts" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page, `#thread=${root.id}&panel=processes`);
  const mainChat = page.locator(".workspace > .chat");
  const composer = mainChat.getByRole("textbox").last();
  await composer.fill("start four slow workers");
  await composer.press("Enter");

  const cards = mainChat.locator(".apx-subthread");
  await expect(cards).toHaveCount(4);
  await expect(cards.getByText("En cola", { exact: true })).toHaveCount(QUEUED);

  const side = page.getByRole("complementary", { name: "Panel lateral" });
  await expect(side.getByText("Activos (4)")).toBeVisible();
  await expect(side.locator(".processes__row").getByText("En cola", { exact: true })).toHaveCount(QUEUED);

  // Opening the queued session says it starts once a slot frees (a delegated session is read-only: no composer).
  await cards
    .filter({ hasText: "En cola" })
    .first()
    .getByRole("button", { name: /^Abrir conversación con/ })
    .click();
  await expect(page.getByText(/^En cola: .+ empieza cuando termine una de las delegaciones en curso$/)).toBeVisible();
  await side.getByRole("button", { name: "Volver a procesos del chat" }).click();

  await expect(side.getByText("Terminados (4)")).toBeVisible({ timeout: 15_000 });
  await expect(cards.getByText("En cola", { exact: true })).toHaveCount(0);
  // Asked in one turn, their results come back together in one turn, which shows their cards again.
  await expect(cards.getByText("Listo", { exact: true })).toHaveCount(8);
});
