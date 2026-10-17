// A read outside the project's folder: the agent's card asks the owner, who lets it read there in this project.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

type Thread = {
  runs: Array<{ ended_at?: string }>;
  messages: Array<{ parts: Array<{ type: string; tool?: string; status?: string }> }>;
};

test("an agent reading its project's parent folder asks with a card; allowing it adds a read-only folder", async ({
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
    await card.getByRole("button", { name: "Permitir leerla en este proyecto" }).click();

    const line = page.locator(".inputline");
    await expect(line).toContainText("Pidió leer una carpeta");
    await expect(line).toContainText("En este proyecto");
    await expect.poll(listed).toEqual([northwind]);
    // The turn goes on and finishes: the command ran.
    const thread = () => rpc<Thread>("threads.get", { thread: chat.id });
    await expect.poll(async () => (await thread()).runs.every((r) => r.ended_at)).toBe(true);
    const parts = (await thread()).messages.flatMap((m) => m.parts);
    expect(parts.some((p) => p.type === "tool" && p.tool === "shell" && p.status === "ok")).toBe(true);
  } finally {
    await rpc("projects.unregister", { project });
    fs.rmSync(northwind, { recursive: true, force: true });
  }
});
