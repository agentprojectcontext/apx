// A file the agent wrote, from the chat's card of changed files: opened in the files panel, or its changes shown.
import type { Message } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("a changed file in the chat opens in the files panel and shows its changes", async ({ page }) => {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "superagent" });
  await rpc("threads.send", { thread: chat.id, text: "write a scratch note" });
  await expect
    .poll(async () => {
      const { messages } = await rpc<{ messages: Message[] }>("threads.get", { thread: chat.id });
      return messages.some((m) => m.parts.some((p) => p.type === "changes" && p.scratch));
    })
    .toBe(true);

  await open(page, `#thread=${chat.id}`);
  const transcript = page.locator(".transcript");
  await expect(transcript).toContainText("Got it: write a scratch note");
  const card = transcript.locator(".changes");
  await expect(card).toContainText("note.md");
  const panel = page.locator(".sidepanel");

  // The temp folder's file, open in the files panel.
  await card.getByRole("button", { name: "Ver archivo" }).click();
  await expect(panel.getByRole("tab", { name: "note.md" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("heading", { name: "Scratch note" })).toBeVisible();
  await panel.getByRole("tab", { name: "Explorador" }).click();
  await expect(panel.getByRole("radio", { name: "Temporales" })).toBeChecked();

  // Its changes, already unfolded in the changes panel, with a way back to the file.
  await card.getByRole("button", { name: "Ver cambios" }).click();
  const row = panel.locator(".wchanges__file.is-open");
  await expect(row).toContainText("note.md");
  await expect(row.locator(".diff__line--add")).toContainText("# Scratch note");
  await row.getByRole("button", { name: "Ver archivo" }).click();
  await expect(panel.getByRole("heading", { name: "Scratch note" })).toBeVisible();
});
