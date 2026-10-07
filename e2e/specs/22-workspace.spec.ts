// A project chat's side panels: Changes (git's diff of the folder), Files (the folder), Terminal (the agent's
// commands and the owner's own shell) and, from its menu, working in the folder like a code session.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

test("a project chat shows its folder's changes, files and a terminal, and can work in the folder", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-ws-")));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Acme", "-c", "user.email=dev@example.com", "-C", repo, ...args]);
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.ts"), "export const a = 1;\n");
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "start");
  fs.writeFileSync(path.join(repo, "src", "app.ts"), "export const a = 2;\n");
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;
  const chat = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "scout",
    project_id: project,
    title: "Paneles",
  });

  // Changes: the file with its counts, unfolding into its diff.
  await open(page, `#thread=${chat.id}&panel=changes`);
  const panel = page.getByRole("complementary", { name: "Panel lateral" });
  await panel.getByRole("button", { name: /app\.ts/ }).click();
  await expect(panel.locator(".diff__line--del")).toContainText("export const a = 1;");
  await expect(panel.locator(".diff__line--add")).toContainText("export const a = 2;");

  // Files: the folder's tree, a file opened and back to the tree.
  await page.goto(`/#thread=${chat.id}&panel=files`);
  await panel.getByRole("button", { name: "AGENTS.md" }).click();
  await expect(panel.getByRole("heading", { name: "Northwind" })).toBeVisible();
  await panel.getByRole("button", { name: "Archivos" }).click();
  await expect(panel.getByRole("button", { name: "src" })).toBeVisible();

  // Terminal: the agent ran nothing yet; the owner's own shell runs in the folder.
  await page.goto(`/#thread=${chat.id}&panel=terminal`);
  await expect(panel.getByText("El agente no corrió comandos en este chat")).toBeVisible();
  await panel.getByRole("button", { name: "Nueva terminal" }).click();
  await expect(panel.locator(".term__xterm .xterm")).toBeVisible();
  await page.keyboard.type("echo e2e-$((6*7))");
  await page.keyboard.press("Enter");
  await expect(panel.locator(".term__xterm")).toContainText("e2e-42", { timeout: 15_000 });

  // The chat's menu: it works in the project's folder, asking before it changes anything.
  await page.locator(".chat__tools").getByRole("button", { name: "Más", exact: true }).click();
  await page.getByRole("menuitem", { name: "Carpeta del proyecto" }).hover();
  await page.getByRole("menuitem", { name: "Pregunta antes de cambiar" }).click();
  await expect(page.locator(".chat__code")).toContainText("Pregunta antes de cambiar");

  // A chat with no project browses where its agent works: APX's work folder.
  await page.goto("/#thread=home");
  await expect(page.locator(".chat__header")).toContainText("Home");
  const switcher = page.locator(".panelswitch");
  await expect(switcher.getByRole("button", { name: "Terminal" })).toHaveCount(1);
  await switcher.getByRole("button", { name: "Archivos" }).click();
  await expect(panel.locator(".files__root")).toContainText("Carpeta de trabajo de APX");
  fs.rmSync(repo, { recursive: true, force: true });
});
