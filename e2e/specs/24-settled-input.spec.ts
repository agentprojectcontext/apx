// An agent's request for the owner's OK: a card while it waits, one quiet line once answered (that opens on click).
import { expect, open, rpc, test } from "./kit.ts";

test("an approved request shrinks to one line saying what was asked and how it ended", async ({ page }) => {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "scout", title: "Permisos" });
  await open(page, `#thread=${chat.id}`);
  await page.getByRole("textbox", { name: /Escribile/ }).fill("make a note file");
  await page.keyboard.press("Enter");

  const card = page.locator(".inputcard.is-pending");
  await expect(card).toContainText("Necesita tu OK");
  await expect(card).toContainText("para usar shell");
  await card.getByRole("button", { name: "Aceptar una vez" }).click();

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
