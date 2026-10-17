// A read outside the project's folder: the agent's card asks the owner. The folder holding the project is only lent
// for that call: kept, it would read to the agent as if its own folder could not change.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

type Thread = {
  runs: Array<{ ended_at?: string }>;
  messages: Array<{ parts: Array<{ type: string; tool?: string; status?: string }> }>;
};

test("an agent reading its project's parent folder asks with a card; it is lent for that call, never kept", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const northwind = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-northwind-")));
  const repo = path.join(northwind, "app");
  fs.mkdirSync(path.join(northwind, "docs"), { recursive: true });
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;
  const listed = async () =>
    (await rpc<{ projects: Array<{ id: string; read_only_folders?: string[] }> }>("projects.list")).projects.find(
      (p) => p.id === project,
    )?.read_only_folders;
  await rpc("agents.create", { slug: "fausto", name: "Fausto" });
  const chat = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "fausto",
    project_id: project,
    title: "Carpetas",
  });
  try {
    await open(page, `#thread=${chat.id}`);
    await page.getByRole("textbox", { name: /Escribile/ }).fill("look around the parent folder");
    await page.keyboard.press("Enter");

    const card = page.locator(".inputcard.is-pending");
    await expect(card).toContainText("Fausto quiere leer");
    await expect(card.locator("code.inputcard__folder")).toHaveText(northwind);
    await expect(card.getByRole("button", { name: "Solo esta vez" })).toBeVisible();
    await expect(card.getByRole("button", { name: "No", exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Permitir leerla en este proyecto" })).toHaveCount(0);
    await card.getByRole("button", { name: "Solo esta vez" }).click();

    await expect(page.locator(".inputline")).toContainText("Pidió leer una carpeta");
    // The turn goes on and finishes: the command ran.
    const thread = () => rpc<Thread>("threads.get", { thread: chat.id });
    await expect.poll(async () => (await thread()).runs.every((r) => r.ended_at)).toBe(true);
    const parts = (await thread()).messages.flatMap((m) => m.parts);
    expect(parts.some((p) => p.type === "tool" && p.tool === "shell" && p.status === "ok")).toBe(true);
    expect(await listed()).toBeUndefined();
  } finally {
    await rpc("projects.unregister", { project });
    fs.rmSync(northwind, { recursive: true, force: true });
  }
});
