import type { Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test, until } from "./kit.ts";

test("a chat waiting for the owner can be stopped from the agents popover", async ({ page }) => {
  await rpc("setup.finish");
  // Its own title: another spec may leave a chat called the same waiting on this shared core.
  const title = `Review days ${Date.now().toString(36)}`;
  const thread = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "superagent", title });
  await rpc("threads.send", { thread: thread.id, text: "ask me which days work" });
  await until(async () => (await rpc<{ inputs: unknown[] }>("runs.pending", { thread: thread.id })).inputs.length > 0);

  await open(page);
  await page.locator("button.running").click();
  const row = page.locator(".running__line").filter({ hasText: title });
  await expect(row.getByText("Te espera")).toBeVisible();
  await row.getByRole("button", { name: "Detener" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Deja de esperar tu respuesta en «${title}»`);
  await dialog.getByRole("button", { name: "Detener" }).click();

  await until(async () => {
    const { thread: now } = await rpc<{ thread: Thread }>("threads.get", { thread: thread.id });
    return now.state !== "input-required";
  });
  expect((await rpc<{ inputs: unknown[] }>("runs.pending", { thread: thread.id })).inputs).toEqual([]);
  await page.locator("button.running").click();
  await expect(page.locator(".running__line").filter({ hasText: title })).toHaveCount(0);
});
