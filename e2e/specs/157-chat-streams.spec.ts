// An answer shows as the model writes it: the chat holds part of it before the whole has come.
import { expect, open, rpc, test, world } from "./kit.ts";

test("an agent's answer grows in the chat while it is written", async ({ page }) => {
  const thread = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "superagent" });
  await open(page, `#thread=${thread.id}`);
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("Write slowly about the plan");
  await box.press("Enter");
  const answer = page.locator(".transcript").getByText(/^Got it: Write slowly about the plan/);
  try {
    await expect(answer).toBeVisible();
    expect(await answer.textContent()).not.toContain("Done.");
  } finally {
    await world.finishStream();
  }
  await expect(answer).toContainText("Done.");
});
