// Importing a project from Codex or Claude Code: the new project dialog lists what is on this computer and brings a
// project's chats in, each with its history.
import { expect, open, rpc, test } from "./kit.ts";

type Found = {
  projects: Array<{ cwd: string; project_id?: string; sessions: Array<{ id: string; thread?: string }> }>;
};

test("a Codex project and its chats come in from the new project dialog", async ({ page }) => {
  await rpc("setup.finish", {});
  await open(page);
  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Importar" }).click();
  await expect(dialog.getByRole("radio", { name: "Codex" })).toBeChecked();
  await expect(dialog.getByRole("combobox", { name: "Proyecto" })).toContainText("acme · chats: 1");
  await dialog.getByRole("button", { name: "Importar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/chats importados \(1\)/)).toBeVisible();

  const { projects } = await rpc<Found>("sessions.projects", { engine: "codex" });
  const acme = projects.find((p) => p.sessions.some((s) => s.id === "cdx1"));
  expect(acme?.project_id).toBeTruthy();
  const thread = acme?.sessions[0]?.thread ?? "";
  const chat = await rpc<{ thread: { title: string }; messages: Array<{ parts: Array<{ text?: string }> }> }>(
    "threads.get",
    { thread },
  );
  expect(chat.thread.title).toBe("Add a footer");
  expect(chat.messages[0]?.parts[0]?.text).toBe("Add a footer");
  await rpc("threads.delete", { thread });
});
