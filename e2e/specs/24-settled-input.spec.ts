// An agent's request for the owner's OK: a card while it waits, one quiet line once answered (that opens on click).
import { expect, open, rpc, test } from "./kit.ts";

test("an approved request shrinks to one line saying what was asked and how it ended", async ({ page }) => {
  await rpc("setup.finish", {});
  // In manual mode a command that changes something asks; Auto would run it unasked (DECISIONS.md#d-106).
  await rpc("agents.update", { agent: "scout", autonomy: "manual" });
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Permisos" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill("make a note file");
  await page.keyboard.press("Enter");

  const card = page.locator(".inputcard.is-pending");
  await expect(card).toContainText("Necesita tu OK");
  await expect(card).toContainText("usar shell");
  await card.getByRole("button", { name: "Aceptar una vez" }).click();
  await rpc("agents.update", { agent: "scout", autonomy: null });

  const line = page.locator(".inputline");
  await expect(line).toContainText("Pidió permiso para usar shell");
  await expect(line).toContainText("Aprobado");
  await expect(page.locator(".inputcard")).toHaveCount(0);
  // The actions' line (the tools group's design), folded until clicked.
  await expect(line).toHaveClass(/apx-actions/);
  await expect(line).not.toContainText("touch e2e-note.txt");
  await line.getByRole("button").click();
  await expect(line).toContainText("touch e2e-note.txt");
});

test("a question with several answers is ticked, then sent, and shows what was picked", async ({ page }) => {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Días" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill("ask me which days");
  await page.keyboard.press("Enter");

  const card = page.locator(".inputcard.is-pending");
  await expect(card).toContainText("Which days work for the Northwind review?");
  // The question is Markdown: bold reads as bold, never as asterisks.
  await expect(card.locator("strong")).toHaveText("Northwind");
  const send = card.getByRole("button", { name: "Enviar" });
  await expect(send).toBeDisabled();
  await card.getByRole("button", { name: "Monday" }).click();
  await card.getByRole("button", { name: "Wednesday" }).click();
  await expect(card.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "false");
  await send.click();

  await expect(page.locator(".inputline")).toContainText("Monday, Wednesday");
  await expect(page.locator(".inputcard")).toHaveCount(0);
});
