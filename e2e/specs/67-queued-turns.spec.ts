// A helper's result that arrives while its caller is still working waits as a turn of that chat: the running
// popover and the chat's processes both list it under the working turn, named after the helper, with the same count.
import type { Agent, Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("a queued delegation result shows, named, with its chat's working turn in the popover and the processes", async ({
  page,
}) => {
  await rpc("setup.finish");
  const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
  const agent = agents.find((a) => a.kind === "secretary");
  if (!agent) throw new Error("Missing super-agent");
  const root = await rpc<Thread>("threads.create", { kind: "loose", agent_id: agent.id, title: "Parity audit" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page, `#thread=${root.id}&panel=processes`);
  const mainChat = page.locator(".workspace > .chat");
  const composer = mainChat.getByRole("textbox").last();
  await composer.fill("start a worker and keep going");
  await composer.press("Enter");

  const side = page.getByRole("complementary", { name: "Panel lateral" });
  // The chat's own turn, the result queued behind it; the helper's conversation is over.
  await expect(side.getByText("Activos (2)")).toBeVisible();
  await expect(side.locator(".processes__row.is-own")).toContainText("Trabajando");
  await expect(side.locator(".turns__row")).toHaveCount(1);
  await expect(side.locator(".turns__row")).toContainText("Resultado de Scout");
  await expect(side.locator(".turns__row")).toContainText("En cola");
  await expect(side.getByText("Terminados (1)")).toBeVisible();

  await page.locator("button.running").click();
  const tabs = page.locator(".running__tabs .running__tabn");
  await expect(tabs.nth(0)).toHaveText("2");
  await expect(tabs.nth(1)).toHaveText("0");
  const list = page.locator(".running__list");
  await expect(list.locator(".running__row")).toContainText("Parity audit");
  await expect(list.locator(".turns__row")).toHaveCount(1);
  await expect(list.locator(".turns__row")).toContainText("Resultado de Scout");
  await page.keyboard.press("Escape");

  // Once the caller's turn ends, the result runs and nothing is left waiting.
  await expect(side.getByText("Activos (0)")).toBeVisible({ timeout: 20_000 });
  await expect(side.locator(".turns__row")).toHaveCount(0);
});

test("a working agent stops from the running popover, only once the owner confirms", async ({ page }) => {
  await rpc("setup.finish");
  const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
  const agent = agents.find((a) => a.kind === "secretary");
  if (!agent) throw new Error("Missing super-agent");
  const root = await rpc<Thread>("threads.create", { kind: "loose", agent_id: agent.id, title: "Long audit" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page, `#thread=${root.id}`);
  const composer = page.locator(".workspace > .chat").getByRole("textbox").last();
  await composer.fill("start a worker and keep going");
  await composer.press("Enter");

  const working = async () => (await rpc<{ thread: Thread }>("threads.get", { thread: root.id })).thread.state;
  await page.locator("button.running").click();
  const line = page.locator(".running__line").filter({ hasText: "Long audit" });
  await line.hover();
  await line.getByRole("button", { name: "Detener" }).click();
  const dialog = page.getByRole("dialog", { name: `¿Detener a ${agent.name}?` });
  await expect(dialog).toContainText("Long audit");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  expect(await working()).toBe("working");

  await page.locator("button.running").click();
  await line.hover();
  await line.getByRole("button", { name: "Detener" }).click();
  await dialog.getByRole("button", { name: "Detener" }).click();
  await expect.poll(working).not.toBe("working");
});
