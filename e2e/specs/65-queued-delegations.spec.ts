// Past three delegations at once from a chat, the next one waits: its card and the chat's processes show it as
// queued, and it starts and reports back once a slot frees.
import type { Agent, Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("a fourth delegation shows as queued, then runs once one of the three ends", async ({ page }) => {
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
  await expect(cards.getByText("En cola", { exact: true })).toHaveCount(1);

  const side = page.getByRole("complementary", { name: "Panel lateral" });
  await expect(side.getByText("Activos (4)")).toBeVisible();
  await expect(side.locator(".processes__row").getByText("En cola", { exact: true })).toHaveCount(1);

  // Opening the queued session says it starts once a slot frees (a delegated session is read-only: no composer).
  await cards
    .filter({ hasText: "En cola" })
    .getByRole("button", { name: /^Abrir conversación con/ })
    .click();
  await expect(page.getByText(/^En cola: .+ empieza cuando termine una de las delegaciones en curso$/)).toBeVisible();
  await side.getByRole("button", { name: "Volver a procesos del chat" }).click();

  await expect(side.getByText("Terminados (4)")).toBeVisible({ timeout: 15_000 });
  await expect(cards.getByText("En cola", { exact: true })).toHaveCount(0);
  // Each result comes back as its own turn, which shows its card again.
  await expect(cards.getByText("Listo", { exact: true })).toHaveCount(8);
});
