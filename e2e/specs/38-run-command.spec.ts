// A shell block an agent wrote runs from any chat: its output streams into a card under the block, its button brings
// that terminal forward in the side panel (where a password could be typed) and, when the command ends, the agent is
// told how it went and answers again.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

test("a suggested command runs in a terminal from the chat and its end wakes the agent", async ({ page }) => {
  await rpc("setup.finish", {});
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-run-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  const project = (await rpc<{ project: { id: string } }>("projects.register", { path: repo })).project.id;
  const chat = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "scout",
    project_id: project,
    title: "Comando sugerido",
  });

  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /^Escribile a/ }).fill("suggest a command");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("echo e2e-suggested-$((6*7))")).toBeVisible();

  await page.getByRole("button", { name: "Ejecutar en una terminal" }).click();
  const out = page.locator(".runcode__out");
  await expect(out.locator(".runcode__screen")).toContainText("e2e-suggested-42", { timeout: 15_000 });
  await expect(out.getByText("Salió con 0")).toBeVisible({ timeout: 15_000 });

  // The command ended: the agent got its output in a new turn and answered.
  await expect(page.locator(".transcript").getByText(/Got it: The owner ran the command you suggested/)).toBeVisible({
    timeout: 15_000,
  });

  // Its terminal is one click away in the side panel, with what it printed.
  await out.getByRole("button", { name: "Abrir en el panel lateral" }).click();
  const panel = page.getByRole("complementary", { name: "Panel lateral" });
  await expect(panel.getByRole("tab", { name: /echo e2e-suggested/ })).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator(".term__xterm")).toContainText("e2e-suggested-42");
  fs.rmSync(repo, { recursive: true, force: true });
});

test("a late attach snapshot does not undo the command's exit event", async ({ page }) => {
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout" });
  await page.route("**/rpc/terminal.open", async (route) => {
    const params = route.request().postDataJSON() as { command: string };
    await route.continue({ postData: JSON.stringify({ ...params, command: `${params.command}; sleep 1` }) });
  });
  await page.route("**/rpc/terminal.attach", async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as { result: { terminal: { alive: boolean } } };
    expect(snapshot.result.terminal.alive).toBe(true);
    // Hold the live snapshot until the core has delivered the exit and the agent's follow-up.
    await expect(page.locator(".transcript").getByText(/Got it: The owner ran the command you suggested/)).toBeVisible({
      timeout: 15_000,
    });
    await route.fulfill({ response });
  });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /^Escribile a/ }).fill("suggest a command");
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Ejecutar en una terminal" }).click();
  const out = page.locator(".runcode__out");
  await expect(out.locator(".runcode__screen")).toContainText("e2e-suggested-42", { timeout: 15_000 });
  await expect(out.getByText("Salió con 0")).toBeVisible();
});

test("in a chat with no project the block runs too, in APX's work folder", async ({ page }) => {
  await open(page, "#thread=home");
  await page.getByRole("textbox", { name: /^Escribile a/ }).fill("suggest a command");
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Ejecutar en una terminal" }).last().click();
  await expect(page.locator(".runcode__out .runcode__screen").last()).toContainText("e2e-suggested-42", {
    timeout: 15_000,
  });
  await expect(page.getByText(/Got it: The owner ran the command you suggested/).last()).toBeVisible({
    timeout: 15_000,
  });
});
